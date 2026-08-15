import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { color, type } from './tokens';

interface TypeProps extends TextProps {
  color?: string;
  align?: TextStyle['textAlign'];
}

function make(base: TextStyle, defaultColor: string) {
  return function Typo({ color: c, align, style, ...rest }: TypeProps) {
    return <Text {...rest} style={[base, { color: c ?? defaultColor, textAlign: align }, style]} />;
  };
}

/** Semantic scale on the system font. Weight does the work, not novelty faces. */
export const LargeTitle = make(type.largeTitle, color.ink);
export const Title = make(type.title, color.ink);
export const Headline = make(type.headline, color.ink);
export const Body = make(type.body, color.ink);
export const Sub = make(type.sub, color.sub);
export const Caption = make(type.caption, color.sub);
