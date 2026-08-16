// scripts/register-xcode-file.js
const path = require('path');
const xcode = require('xcode');

const projectPath = path.join(__dirname, '..', 'ios', 'Kart.xcodeproj', 'project.pbxproj');
const project = xcode.project(projectPath);
project.parseSync();

const target = project.getFirstTarget().uuid;
const groupKey = project.findPBXGroupKey({ name: 'Kart' });

const FILES = [
  'KartVisionFrameProcessorPlugin.swift',
  'KartVisionFrameProcessorPlugin.m',
  'KartDetector.swift',
  'MaskContour.swift',
  'FrameMetrics.swift',
  'AppleInstanceMaskDetector.swift',
  'KartImageTools.swift',
  'KartFrameLab.swift',
  'KartFrameLab.m',
];

for (const file of FILES) {
  const relativePath = `Kart/${file}`;
  const alreadyPresent = Object.values(project.hash.project.objects.PBXFileReference || {}).some(
    // `path` values may retain literal surrounding quotes from the pbxproj serialization
    // (e.g. `"Kart/Foo.swift"` as a raw string), so compare with those stripped.
    (ref) => typeof ref === 'object' && typeof ref.path === 'string' && ref.path.replace(/^"|"$/g, '') === relativePath,
  );
  if (alreadyPresent) {
    console.log(`${file} already registered, skipping`);
    continue;
  }
  project.addSourceFile(relativePath, { target }, groupKey);
  console.log(`Registered ${file}`);
}

require('fs').writeFileSync(projectPath, project.writeSync());
