import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse, { type NodePath, type Node } from '@babel/traverse';
import type { BlockStatement, CallExpression, OptionalCallExpression } from '@babel/types';

/**
 * Guards the exact bug this file exists to prevent: `scan.tsx`'s frame processor worklet
 * calling a plain (non-worklet) function from `orchestrator.ts`.
 *
 * The installed react-native-worklets-core@1.6.3 babel plugin only workletizes a function that
 * carries an explicit 'worklet' directive (see its FunctionDeclaration|FunctionExpression|
 * ArrowFunctionExpression visitor in src/plugin/index.js); it never walks a worklet's call
 * graph to workletize whatever it references. At runtime, a plain function crossing into the
 * worklet runtime as a closure value is wrapped as a stub that throws "Regular javascript
 * function '<name>' cannot be shared..." the moment it is called
 * (cpp/wrappers/WKTJsiObjectWrapper.h, setFunctionValue). Neither a device nor a simulator is
 * available in this test environment to execute that native boundary directly, so this test
 * verifies the property statically instead: nothing in orchestrator.ts that lacks a 'worklet'
 * directive may be called from inside scan.tsx's frame processor.
 */

const ORCHESTRATOR_PATH = path.join(__dirname, '../../engine/liveVision/orchestrator.ts');
const SCAN_PATH = path.join(__dirname, '../scan.tsx');

function hasWorkletDirective(body: BlockStatement | null | undefined): boolean {
  if (!body) return false;
  return body.directives.some((d) => d.value.value === 'worklet');
}

function collectNonWorkletOrchestratorNames(): Set<string> {
  const source = fs.readFileSync(ORCHESTRATOR_PATH, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });

  const names = new Set<string>();
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id && !hasWorkletDirective(p.node.body)) names.add(p.node.id.name);
    },
    ClassMethod(p) {
      if (p.node.key.type === 'Identifier' && !hasWorkletDirective(p.node.body)) {
        names.add(p.node.key.name);
      }
    },
  });
  return names;
}

function findFrameProcessorArg(): NodePath<Node> {
  const source = fs.readFileSync(SCAN_PATH, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

  let found: NodePath<Node> | null = null;
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === 'Identifier' && callee.name === 'useFrameProcessor') {
        found = p.get('arguments.0') as NodePath<Node>;
      }
    },
  });

  if (found === null) throw new Error('useFrameProcessor(...) call not found in scan.tsx');
  return found;
}

describe('scan.tsx frame processor worklet boundary', () => {
  it('never calls a non-worklet orchestrator function or method from inside the frame processor', () => {
    const nonWorkletNames = collectNonWorkletOrchestratorNames();

    // Sanity check that the guard is still checking something real. If either of these ever
    // grows a 'worklet' directive, this line should be what fails, not the assertion below, so
    // a reviewer notices the safety property changed on purpose rather than the test going
    // quietly vacuous.
    expect(nonWorkletNames.has('tracksNeedingThumbnail')).toBe(true);
    expect(nonWorkletNames.has('wantsKeyframe')).toBe(true);

    const frameProcessorArg = findFrameProcessorArg();

    const offendingCalls: string[] = [];
    let sawScanCart = false;
    function checkCallee(callee: CallExpression['callee'] | OptionalCallExpression['callee']) {
      let name: string | null = null;
      if (callee.type === 'Identifier') {
        name = callee.name;
      } else if (
        (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
        callee.property.type === 'Identifier'
      ) {
        name = callee.property.name;
      }
      if (name === 'scanCart') sawScanCart = true;
      if (name && nonWorkletNames.has(name)) offendingCalls.push(name);
    }
    // `session?.wantsKeyframe(...)` parses as OptionalCallExpression/OptionalMemberExpression,
    // not CallExpression/MemberExpression, so both call shapes need to be visited or an
    // optional-chained call to a non-worklet method would silently pass this check.
    frameProcessorArg.traverse({
      CallExpression(p) {
        checkCallee(p.node.callee);
      },
      OptionalCallExpression(p) {
        checkCallee(p.node.callee);
      },
    });

    // Confirms the traversal actually walked the real frame processor body, not an empty or
    // wrong node, before trusting an empty `offendingCalls` as a pass.
    expect(sawScanCart).toBe(true);
    expect(offendingCalls).toEqual([]);
  });
});
