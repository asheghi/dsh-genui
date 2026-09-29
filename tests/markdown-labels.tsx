import { MarkdownText as PrimitiveMarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentProps } from 'react'

const MARKDOWN_LABELS = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
} satisfies NonNullable<ComponentProps<typeof PrimitiveMarkdownText>['labels']>

/** Render MarkdownText with the rc.1 labels required by the host primitive. */
export function MarkdownText(props: Omit<ComponentProps<typeof PrimitiveMarkdownText>, 'labels'>): ReturnType<typeof PrimitiveMarkdownText> {
  return <PrimitiveMarkdownText {...props} labels={MARKDOWN_LABELS} />
}
