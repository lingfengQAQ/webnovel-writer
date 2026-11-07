import * as React from 'react'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular, IconChevronsUpDownOutlineRegular, IconCloseOutlineRegular, IconCompareSplitOutlineRegular,
  IconContextInjectionOutlineRegular, IconCopyOutlineRegular, IconDatabaseOutlineRegular, IconDownloadOutlineRegular,
  IconEditOutlineRegular, IconEllipsisOutlineRegular, IconFlatListOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
  IconFullscreenOutlineRegular, IconGoalOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconSearchOutlineRegular, IconSendOutlineRegular, IconSparkleRegular,
  IconWarningTriangleOutlineRegular, IconSettingsOutlineRegular, type IconProps,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Every client glyph: DSH product icons where one exists, otherwise drawn here on the same 16px grid. */
export type Icon = (props: IconProps) => React.ReactElement

export const IconCheck: Icon = IconCheckOutlineRegular
export const IconChevronDown: Icon = IconChevronDownOutlineRegular
export const IconChevronLeft: Icon = IconChevronLeftOutlineRegular
export const IconChevronRight: Icon = IconChevronRightOutlineRegular
export const IconChevronUp: Icon = IconChevronUpOutlineRegular
export const IconChevronsUpDown: Icon = IconChevronsUpDownOutlineRegular
export const IconClose: Icon = IconCloseOutlineRegular
export const IconCompare: Icon = IconCompareSplitOutlineRegular
export const IconQuote: Icon = IconContextInjectionOutlineRegular
export const IconCopy: Icon = IconCopyOutlineRegular
export const IconDatabase: Icon = IconDatabaseOutlineRegular
export const IconLoadDisk: Icon = IconDownloadOutlineRegular
export const IconContinue: Icon = IconEditOutlineRegular
export const IconMore: Icon = IconEllipsisOutlineRegular
export const IconOutline: Icon = IconFlatListOutlineRegular
export const IconFolder: Icon = IconFolderCloseRegular
export const IconFolderOpen: Icon = IconFolderOpenRegular
export const IconFullscreen: Icon = IconFullscreenOutlineRegular
export const IconLocate: Icon = IconGoalOutlineRegular
export const IconPause: Icon = IconPauseOutlineRegular
export const IconPlay: Icon = IconPlayOutlineRegular
export const IconPlus: Icon = IconPlusOutlineRegular
export const IconRefresh: Icon = IconRefreshOutlineRegular
export const IconOpen: Icon = IconRightUpOutlineRegular
export const IconSearch: Icon = IconSearchOutlineRegular
export const IconSend: Icon = IconSendOutlineRegular
export const IconSparkle: Icon = IconSparkleRegular
export const IconWarning: Icon = IconWarningTriangleOutlineRegular
export const IconSettings: Icon = IconSettingsOutlineRegular

/**
 * Glyphs DSH does not ship. Same contract as the DSH Regular set: 16x16 viewBox, 1px currentColor stroke
 * on the svg root, decorative (aria-hidden), size and className only.
 */
function glyph(name: string, body: React.ReactNode): Icon {
  const Glyph = ({ size = 16, className }: IconProps) => <svg width={size} height={size} className={className} viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true" data-icon={name}>{body}</svg>
  Glyph.displayName = 'Icon' + name
  return Glyph
}
const corners = <>
  <path d="M2 5.5V3.5C2 2.67 2.67 2 3.5 2H5.5" /><path d="M10.5 2H12.5C13.33 2 14 2.67 14 3.5V5.5" />
  <path d="M14 10.5V12.5C14 13.33 13.33 14 12.5 14H10.5" /><path d="M5.5 14H3.5C2.67 14 2 13.33 2 12.5V10.5" />
</>
const letterA = <><path d="M1.5 13.5L5.25 3L9 13.5" /><path d="M2.75 10H7.75" /></>
const heading = <><path d="M2 3V13" /><path d="M8 3V13" /><path d="M2 8H8" /></>
const verticalSeam = <><path d="M8 1.5V3.5" /><path d="M8 6.5V9.5" /><path d="M8 12.5V14.5" /></>
const horizontalSeam = <><path d="M2 8H4" /><path d="M6.5 8H9.5" /><path d="M12 8H14" /></>

export const IconBook = glyph('Book', <>
  <path d="M8 4.2C6.6 3.1 4.6 2.6 1.5 2.7V12.6C4.6 12.5 6.6 13 8 14.1" />
  <path d="M8 4.2C9.4 3.1 11.4 2.6 14.5 2.7V12.6C11.4 12.5 9.4 13 8 14.1" /><path d="M8 4.2V14.1" />
</>)
export const IconRelations = glyph('Relations', <>
  <circle cx="8" cy="3.75" r="1.75" /><circle cx="3.25" cy="12" r="1.75" /><circle cx="12.75" cy="12" r="1.75" />
  <path d="M7.13 5.27L4.12 10.48" /><path d="M8.87 5.27L11.88 10.48" /><path d="M5 12H11" />
</>)
export const IconWorkflow = glyph('Workflow', <>
  <rect x="1.5" y="2.5" width="5" height="4" rx="1" /><rect x="9.5" y="9.5" width="5" height="4" rx="1" />
  <path d="M4 6.5V9.5C4 10.6 4.9 11.5 6 11.5H9.5" />
</>)
export const IconActivity = glyph('Activity', <path d="M1.5 8.5H4.25L6.25 3.5L9.75 12.5L11.75 8.5H14.5" strokeLinejoin="round" />)
export const IconFitView = glyph('FitView', <>{corners}<circle cx="8" cy="8" r="2.25" /></>)
export const IconMinus = glyph('Minus', <path d="M2 8H14" />)
export const IconSwap = glyph('Swap', <>
  <path d="M2 5.5H13.5" /><path d="M10.5 2.5L13.5 5.5L10.5 8.5" /><path d="M14 10.5H2.5" /><path d="M5.5 7.5L2.5 10.5L5.5 13.5" />
</>)
export const IconRebuild = glyph('Rebuild', <>
  <path d="M1.5 8A6.5 6.5 0 1 0 8 1.5C6.1 1.5 4.3 2.3 3 3.6L1.5 5.1" /><path d="M1.5 1.5V5.1H5.1" />
</>)
export const IconCut = glyph('Cut', <>
  <circle cx="4" cy="11.75" r="2.25" /><circle cx="12" cy="11.75" r="2.25" /><path d="M5.48 10.05L12.5 2" /><path d="M10.52 10.05L3.5 2" />
</>)
export const IconPaste = glyph('Paste', <>
  <path d="M5.5 3H4C3.17 3 2.5 3.67 2.5 4.5V13C2.5 13.83 3.17 14.5 4 14.5H12C12.83 14.5 13.5 13.83 13.5 13V4.5C13.5 3.67 12.83 3 12 3H10.5" />
  <rect x="5.5" y="1.5" width="5" height="3" rx="1" /><path d="M5.5 8.5H10.5" /><path d="M5.5 11H9" />
</>)
export const IconSelectAll = glyph('SelectAll', <>
  <rect x="2" y="2" width="12" height="12" rx="1.5" strokeDasharray="2 1.5" /><path d="M5 6H11" /><path d="M5 8.5H11" /><path d="M5 11H8.5" />
</>)
export const IconUndo = glyph('Undo', <>
  <path d="M5.5 3L2.5 6L5.5 9" /><path d="M2.5 6H10C12 6 13.5 7.6 13.5 9.5S12 13 10 13H6.5" />
</>)
export const IconRedo = glyph('Redo', <>
  <path d="M10.5 3L13.5 6L10.5 9" /><path d="M13.5 6H6C4 6 2.5 7.6 2.5 9.5S4 13 6 13H9.5" />
</>)
export const IconSave = glyph('Save', <>
  <path d="M2.5 3.5C2.5 2.95 2.95 2.5 3.5 2.5H11L13.5 5V12.5C13.5 13.05 13.05 13.5 12.5 13.5H3.5C2.95 13.5 2.5 13.05 2.5 12.5Z" />
  <path d="M5 2.5V5.5H10V2.5" /><path d="M5 13.5V9.5H11V13.5" />
</>)
export const IconPolish = glyph('Polish', <>
  <path d="M13.5 2.5C8.5 2.5 4.5 5.5 4.5 11.5C9.5 11.5 13.5 8 13.5 2.5Z" /><path d="M2.5 13.5L10 6" />
</>)
export const IconLengthen = glyph('Lengthen', <>
  <path d="M8 1.5V6" /><path d="M5.5 4L8 1.5L10.5 4" /><path d="M8 14.5V10" /><path d="M5.5 12L8 14.5L10.5 12" />{horizontalSeam}
</>)
export const IconCondense = glyph('Condense', <>
  <path d="M8 1.5V6" /><path d="M5.5 3.5L8 6L10.5 3.5" /><path d="M8 14.5V10" /><path d="M5.5 12.5L8 10L10.5 12.5" />{horizontalSeam}
</>)
export const IconReview = glyph('Review', <>
  {corners}<path d="M4 8C5 6.2 6.4 5.25 8 5.25S11 6.2 12 8C11 9.8 9.6 10.75 8 10.75S5 9.8 4 8Z" /><circle cx="8" cy="8" r="1.25" />
</>)
export const IconParagraph = glyph('Paragraph', <>
  <path d="M12.5 2.5H6.75C5.23 2.5 4 3.73 4 5.25S5.23 8 6.75 8H8" /><path d="M8 2.5V13.5" /><path d="M11 2.5V13.5" />
</>)
export const IconHeading1 = glyph('Heading1', <>{heading}<path d="M10.5 5.5L12.5 4V13" /></>)
export const IconHeading2 = glyph('Heading2', <>{heading}<path d="M10.25 5.5C10.5 4.6 11.2 4 12.1 4C13.1 4 13.9 4.8 13.9 5.8C13.9 7.9 10.25 9.8 10.25 13H14" /></>)
export const IconHeading3 = glyph('Heading3', <>{heading}<path d="M10.25 4H13.75L11.75 7.75C13 7.75 14 8.75 14 10.25S12.9 13 11.6 13C10.9 13 10.3 12.7 10 12.2" /></>)
export const IconBlockquote = glyph('Blockquote', <>
  <path d="M3 3V13" /><path d="M6 4.5H13.5" /><path d="M6 8H13.5" /><path d="M6 11.5H11" />
</>)
export const IconList = glyph('List', <>
  <circle cx="3" cy="4.5" r=".75" fill="currentColor" stroke="none" /><circle cx="3" cy="8" r=".75" fill="currentColor" stroke="none" />
  <circle cx="3" cy="11.5" r=".75" fill="currentColor" stroke="none" /><path d="M6 4.5H13.5" /><path d="M6 8H13.5" /><path d="M6 11.5H13.5" />
</>)
export const IconSceneBreak = glyph('SceneBreak', <><path d="M1.5 8H5.5" /><path d="M10.5 8H14.5" /><path d="M8 5.5L10.5 8L8 10.5L5.5 8Z" /></>)
export const IconBold = glyph('Bold', <>
  <path d="M4.5 2.5H9C10.38 2.5 11.5 3.62 11.5 5S10.38 7.75 9 7.75H4.5Z" />
  <path d="M4.5 7.75H9.75C11.27 7.75 12.5 8.93 12.5 10.63S11.27 13.5 9.75 13.5H4.5Z" />
</>)
export const IconItalic = glyph('Italic', <><path d="M7 2.5H12.5" /><path d="M3.5 13.5H9" /><path d="M9.75 2.5L6.25 13.5" /></>)
export const IconTypography = glyph('Typography', <>{letterA}<path d="M9.75 13.5L12.25 7L14.75 13.5" /><path d="M10.6 11.25H13.9" /></>)
export const IconFontLarger = glyph('FontLarger', <>{letterA}<path d="M12.5 13.5V3.5" /><path d="M10.25 5.75L12.5 3.5L14.75 5.75" /></>)
export const IconFontSmaller = glyph('FontSmaller', <>{letterA}<path d="M12.5 2.5V12.5" /><path d="M10.25 10.25L12.5 12.5L14.75 10.25" /></>)
export const IconMatchCase = glyph('MatchCase', <>
  <path d="M1.5 12.5L4.75 3.5L8 12.5" /><path d="M2.6 9.5H6.9" /><circle cx="11.75" cy="10.25" r="2.25" /><path d="M14 7.5V12.5" />
</>)
export const IconReplace = glyph('Replace', <>
  <rect x="1.5" y="2" width="6" height="4.5" rx="1" /><rect x="8.5" y="9.5" width="6" height="4.5" rx="1" />
  <path d="M9.5 4.25H10.5C11.33 4.25 12 4.92 12 5.75V7.75" /><path d="M10.5 6.25L12 7.75L13.5 6.25" />
</>)
export const IconReplaceAll = glyph('ReplaceAll', <>
  <rect x="1.5" y="1.5" width="6" height="3.5" rx="1" /><rect x="1.5" y="6.5" width="6" height="3.5" rx="1" />
  <rect x="8.5" y="10.5" width="6" height="4" rx="1" /><path d="M9.5 3.25H10.5C11.33 3.25 12 3.92 12 4.75V8.75" /><path d="M10.5 7.25L12 8.75L13.5 7.25" />
</>)
export const IconIndent = glyph('Indent', <>
  <path d="M1.5 1.5L4 3.25L1.5 5" /><path d="M6.5 3.25H14.5" /><path d="M1.5 7.25H14.5" /><path d="M1.5 10.75H14.5" /><path d="M1.5 14.25H10" />
</>)
export const IconLineHeight = glyph('LineHeight', <>
  <path d="M3.5 1.5V14.5" /><path d="M1.5 3.5L3.5 1.5L5.5 3.5" /><path d="M1.5 12.5L3.5 14.5L5.5 12.5" />
  <path d="M8 4H14.5" /><path d="M8 8H14.5" /><path d="M8 12H14.5" />
</>)
export const IconPageWidth = glyph('PageWidth', <><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" /><path d="M4.5 6.5H11.5" /><path d="M4.5 9.5H11.5" /></>)
export const IconNarrower = glyph('Narrower', <>
  <path d="M1.5 8H6.25" /><path d="M3.75 5.5L6.25 8L3.75 10.5" /><path d="M14.5 8H9.75" /><path d="M12.25 5.5L9.75 8L12.25 10.5" />{verticalSeam}
</>)
export const IconWider = glyph('Wider', <>
  <path d="M1.5 8H6" /><path d="M4 5.5L1.5 8L4 10.5" /><path d="M14.5 8H10" /><path d="M12 5.5L14.5 8L12 10.5" />{verticalSeam}
</>)
