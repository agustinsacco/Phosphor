import clsx from 'clsx'

/**
 * The annotator's toolbar: tools, colour, size, history and the two image
 * sources. Presentational only; `ImageEditor` owns every piece of state.
 */

export type Tool = 'select' | 'pen' | 'highlight' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'step'

export type Size = 'S' | 'M' | 'L'

/** Screen-pixel sizes; the editor multiplies by its zoom when drawing. */
export const SIZES: Record<Size, { stroke: number; text: number; step: number }> = {
  S: { stroke: 3, text: 16, step: 11 },
  M: { stroke: 5, text: 22, step: 15 },
  L: { stroke: 8, text: 30, step: 20 },
}

/** Red first: it is the colour that reads as "look here" on a screenshot. */
export const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111111', '#ffffff']

const glyph = (children: React.ReactNode): React.JSX.Element => (
  <svg
    width={17}
    height={17}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

export const TOOLS: { tool: Tool; key: string; label: string; icon: React.JSX.Element }[] = [
  {
    tool: 'select',
    key: 'v',
    label: 'Select and move',
    icon: glyph(<path d="M5 3l6 17 2.5-7.5L21 10z" />),
  },
  {
    tool: 'rect',
    key: 'r',
    label: 'Rectangle',
    icon: glyph(<rect x="4" y="5" width="16" height="14" rx="1" />),
  },
  {
    tool: 'ellipse',
    key: 'o',
    label: 'Circle',
    icon: glyph(<ellipse cx="12" cy="12" rx="9" ry="7.5" />),
  },
  {
    tool: 'arrow',
    key: 'a',
    label: 'Arrow',
    icon: glyph(
      <>
        <path d="M5 19L19 5" />
        <path d="M9 5h10v10" />
      </>,
    ),
  },
  {
    tool: 'pen',
    key: 'p',
    label: 'Draw',
    icon: glyph(
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
      </>,
    ),
  },
  {
    tool: 'highlight',
    key: 'h',
    label: 'Highlight',
    icon: glyph(
      <>
        <path d="M9 11l-6 6v3h9l3-3" />
        <path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4" />
      </>,
    ),
  },
  {
    tool: 'text',
    key: 't',
    label: 'Text',
    icon: glyph(
      <>
        <path d="M5 7V4h14v3" />
        <path d="M12 4v16" />
        <path d="M9 20h6" />
      </>,
    ),
  },
  {
    tool: 'step',
    key: 'n',
    label: 'Numbered marker',
    icon: glyph(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M10.5 9l2-1.5V16" />
      </>,
    ),
  },
]

const UNDO = glyph(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </>,
)
const REDO = glyph(
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
  </>,
)
const TRASH = glyph(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 14h10l1-14" />
  </>,
)

const ICON_BUTTON =
  'text-text-secondary hover:text-text hover:bg-bg-secondary flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30'

/** Keeps focus where it is (the text being typed) when a control is clicked. */
const keepFocus = (event: React.MouseEvent): void => event.preventDefault()

function Divider(): React.JSX.Element {
  return <div className="bg-border mx-1 h-5 w-px" />
}

export function EditorToolbar(props: {
  tool: Tool
  onTool: (tool: Tool) => void
  color: string
  onColor: (color: string) => void
  size: Size
  onSize: (size: Size) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  canDelete: boolean
  onDelete: () => void
  onPaste: () => void
  onReplace: () => void
}): React.JSX.Element {
  return (
    <div
      className="border-border flex flex-wrap items-center gap-0.5 border-b px-3 py-1.5"
      role="toolbar"
      aria-label="Annotation tools"
    >
      {TOOLS.map(({ tool, key, label, icon }) => (
        <button
          key={tool}
          type="button"
          aria-label={label}
          aria-pressed={props.tool === tool}
          title={`${label} (${key.toUpperCase()})`}
          onClick={() => props.onTool(tool)}
          className={clsx(
            ICON_BUTTON,
            props.tool === tool && 'bg-bg-secondary text-text ring-border-strong ring-1',
          )}
        >
          {icon}
        </button>
      ))}
      <Divider />
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          aria-pressed={props.color === c}
          onMouseDown={keepFocus}
          onClick={() => props.onColor(c)}
          className="flex h-8 w-7 items-center justify-center"
        >
          <span
            style={{ background: c }}
            className={clsx(
              'border-border-strong h-4.5 w-4.5 rounded-full border',
              props.color === c && 'ring-accent ring-2 ring-offset-1',
            )}
          />
        </button>
      ))}
      <Divider />
      {(['S', 'M', 'L'] as const).map((s, i) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          aria-pressed={props.size === s}
          title={['Thin', 'Medium', 'Thick'][i]}
          onMouseDown={keepFocus}
          onClick={() => props.onSize(s)}
          className={clsx(ICON_BUTTON, props.size === s && 'bg-bg-secondary text-text')}
        >
          <span
            className="rounded-full bg-current"
            style={{ width: 4 + i * 4, height: 4 + i * 4 }}
          />
        </button>
      ))}
      <Divider />
      <button
        type="button"
        aria-label="Undo"
        title="Undo (⌘Z)"
        disabled={!props.canUndo}
        onClick={props.onUndo}
        className={ICON_BUTTON}
      >
        {UNDO}
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
        disabled={!props.canRedo}
        onClick={props.onRedo}
        className={ICON_BUTTON}
      >
        {REDO}
      </button>
      <button
        type="button"
        aria-label="Delete selected"
        title="Delete selected (⌫)"
        disabled={!props.canDelete}
        onClick={props.onDelete}
        className={ICON_BUTTON}
      >
        {TRASH}
      </button>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          title="Put the clipboard's image on top (⌘V)"
          onClick={props.onPaste}
          className="text-text-secondary hover:text-text hover:bg-bg-secondary rounded-md px-2 py-1 text-base"
        >
          Paste image
        </button>
        <button
          type="button"
          title="Swap the screenshot underneath for the clipboard's image (⇧⌘V)"
          onClick={props.onReplace}
          className="text-text-secondary hover:text-text hover:bg-bg-secondary rounded-md px-2 py-1 text-base"
        >
          Replace image
        </button>
      </div>
    </div>
  )
}
