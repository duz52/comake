import type {
  Frame,
  HexColor,
  Presentation,
  PresentationElement,
  ShapeElement,
  ShapeFill,
  ShapeStyle,
  Slide,
  TextElement,
  TextStyle,
} from '../../types/presentation';

export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;

/** Canonical identifiers of the P0 launch workspace and its landing slide. */
export const LAUNCH_WORKSPACE_ID = 'webmcp-launch';
export const LAUNCH_DECK_ID = 'deck-webmcp-launch';
export const LAUNCH_DECK_INITIAL_SLIDE_ID = 'slide-gap';

function text(
  id: string,
  name: string,
  frame: Frame,
  value: string,
  style: TextStyle,
): TextElement {
  return { id, kind: 'text', name, frame, text: value, style };
}

function shape(id: string, name: string, frame: Frame, style: ShapeStyle): ShapeElement {
  return { id, kind: 'shape', name, frame, style };
}

function solidFill(color: HexColor): ShapeFill {
  return { kind: 'solid', color, opacity: 1 };
}

function rectStyle(cornerRadius: number, color: HexColor): ShapeStyle {
  return { fill: solidFill(color), geometry: { kind: 'rectangle', cornerRadius }, stroke: { kind: 'none' } };
}

function ellipseStyle(color: HexColor): ShapeStyle {
  return { fill: solidFill(color), geometry: { kind: 'ellipse' }, stroke: { kind: 'none' } };
}

function slide(
  id: string,
  name: string,
  background: string,
  elements: PresentationElement[],
): Slide {
  return {
    id,
    name,
    background,
    elementOrder: elements.map((element) => element.id),
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
  };
}

const labelStyle: TextStyle = {
  color: '#ec6f42',
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
};

const headingStyle: TextStyle = {
  color: '#f8f2e8',
  fontFamily: 'Fraunces, Georgia, serif',
  fontSize: 61,
  fontWeight: 600,
  letterSpacing: -2.8,
  lineHeight: 0.93,
};

const bodyStyle: TextStyle = {
  color: '#d5d0c7',
  fontFamily: 'Manrope, sans-serif',
  fontSize: 19,
  lineHeight: 1.42,
};

export function createLaunchDeck(): Presentation {
  const cover = slide('slide-cover', 'The cover', '#171713', [
    shape('cover-bar', 'Orange sidebar', { x: 57, y: 74, width: 8, height: 344 }, rectStyle(4, '#ec6f42')),
    text('cover-kicker', 'Kicker', { x: 89, y: 83, width: 390, height: 28 }, 'COMAKE / 01', labelStyle),
    text(
      'cover-title',
      'Title',
      { x: 87, y: 142, width: 706, height: 160 },
      'A desk built\nfor two minds.',
      { ...headingStyle, fontSize: 77 },
    ),
    text(
      'cover-body',
      'Subtitle',
      { x: 91, y: 343, width: 430, height: 62 },
      'A shared canvas where people and agents\nmake the work together.',
      bodyStyle,
    ),
    shape('cover-orbit', 'Orbit', { x: 710, y: 132, width: 132, height: 132 }, ellipseStyle('#ffd14e')),
    shape('cover-orbit-core', 'Orbit core', { x: 748, y: 170, width: 56, height: 56 }, ellipseStyle('#171713')),
    text(
      'cover-footer',
      'Footer',
      { x: 89, y: 476, width: 740, height: 20 },
      'WEBMCP LAUNCH DECK  ·  AUG 2026',
      { ...labelStyle, color: '#8e8a80', fontSize: 10, letterSpacing: 1.3 },
    ),
  ]);

  const problem = slide('slide-problem', 'The problem', '#f4efe7', [
    text('problem-kicker', 'Kicker', { x: 69, y: 65, width: 360, height: 24 }, 'THE MOMENT / 02', labelStyle),
    text(
      'problem-title',
      'Title',
      { x: 68, y: 123, width: 720, height: 112 },
      'A good agent should\nfeel like a teammate.',
      { ...headingStyle, color: '#1c1c18', fontSize: 57 },
    ),
    text(
      'problem-body',
      'Body',
      { x: 72, y: 295, width: 354, height: 92 },
      'Not a tab. Not a black box.\nA visible collaborator in the work itself.',
      { ...bodyStyle, color: '#4c4a42' },
    ),
    shape('problem-line', 'Line', { x: 509, y: 304, width: 296, height: 2 }, rectStyle(1, '#1c1c18')),
    shape('problem-card-one', 'Human card', { x: 507, y: 342, width: 136, height: 106 }, rectStyle(14, '#1c1c18')),
    text(
      'problem-card-one-label',
      'Human label',
      { x: 526, y: 364, width: 100, height: 20 },
      'HUMAN',
      { ...labelStyle, color: '#ffd14e', fontSize: 10 },
    ),
    text(
      'problem-card-one-copy',
      'Human copy',
      { x: 526, y: 397, width: 100, height: 28 },
      'Context\nand taste',
      { ...bodyStyle, color: '#f8f2e8', fontSize: 13, lineHeight: 1.16 },
    ),
    shape('problem-card-two', 'Agent card', { x: 669, y: 342, width: 136, height: 106 }, rectStyle(14, '#ec6f42')),
    text(
      'problem-card-two-label',
      'Agent label',
      { x: 688, y: 364, width: 100, height: 20 },
      'AGENT',
      { ...labelStyle, color: '#1c1c18', fontSize: 10 },
    ),
    text(
      'problem-card-two-copy',
      'Agent copy',
      { x: 688, y: 397, width: 100, height: 28 },
      'Throughput\nand range',
      { ...bodyStyle, color: '#1c1c18', fontSize: 13, lineHeight: 1.16 },
    ),
  ]);

  const gap = slide(LAUNCH_DECK_INITIAL_SLIDE_ID, 'The co-work gap', '#20201b', [
    text('gap-kicker', 'Kicker', { x: 70, y: 66, width: 340, height: 24 }, 'THE CO-WORK GAP / 03', labelStyle),
    text(
      'gap-title',
      'Title',
      { x: 69, y: 121, width: 570, height: 72 },
      'The context is already here.',
      { ...headingStyle, fontSize: 47 },
    ),
    text(
      'gap-body',
      'Body',
      { x: 72, y: 227, width: 370, height: 76 },
      'The human has been shaping the work.\nThe agent needs a way in—not a reset.',
      bodyStyle,
    ),
    shape('gap-rule', 'Rule', { x: 72, y: 352, width: 811, height: 1 }, rectStyle(0, '#545148')),
    text(
      'gap-prompt',
      'Prompt',
      { x: 72, y: 388, width: 605, height: 54 },
      '“Finish the next two slides in this voice.\nLeave a comment where you are unsure.”',
      { ...bodyStyle, color: '#ffd14e', fontSize: 18, lineHeight: 1.27 },
    ),
  ]);

  const system = slide('slide-system', 'The shared system', '#ffd14e', [
    text('system-kicker', 'Kicker', { x: 70, y: 65, width: 390, height: 24 }, 'THE SHARED SYSTEM / 04', { ...labelStyle, color: '#b14727' }),
    text(
      'system-title',
      'Title',
      { x: 68, y: 120, width: 710, height: 84 },
      'One artifact.\nTwo ways of making.',
      { ...headingStyle, color: '#1b1b17', fontSize: 55 },
    ),
    text(
      'system-body',
      'Body',
      { x: 72, y: 332, width: 370, height: 72 },
      'The human moves the shape.\nThe agent sees the new truth.',
      { ...bodyStyle, color: '#514710' },
    ),
    shape('system-rule', 'Rule', { x: 70, y: 452, width: 818, height: 2 }, rectStyle(1, '#1b1b17')),
  ]);

  return {
    id: LAUNCH_DECK_ID,
    revision: 0,
    size: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
    slideOrder: [cover.id, problem.id, gap.id, system.id],
    slides: {
      [cover.id]: cover,
      [problem.id]: problem,
      [gap.id]: gap,
      [system.id]: system,
    },
    title: 'WebMCP launch deck',
  };
}
