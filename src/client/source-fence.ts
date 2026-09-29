import { fromMarkdown } from 'mdast-util-from-markdown'
import type { AssistantBlock, ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

export interface SourceFence {
  lang: string | null
  value: string
  openingLineComplete: boolean
}

interface MarkdownNode {
  type: string
  lang?: string | null
  value?: string
  children?: MarkdownNode[]
  position?: { start: { offset?: number } }
}

/**
 * Read every code fence in Markdown document order.
 *
 * @param markdown - Markdown content of an assistant text block
 * @returns the code fences in the Markdown AST
 */
export function sourceFencesOf(markdown: string): SourceFence[] {
  const fences: SourceFence[] = []
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'code') {
      const openingOffset = node.position?.start.offset
      const openingLineEnd = openingOffset === undefined ? -1 : markdown.indexOf('\n', openingOffset)
      fences.push({
        lang: node.lang ?? null,
        value: node.value as string,
        openingLineComplete: openingLineEnd >= 0,
      })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(fromMarkdown(markdown) as unknown as MarkdownNode)
  return fences
}

/**
 * Read code fences only from the assistant's text blocks.
 *
 * @param blocks - assistant content blocks provided by ChatSnapshot
 * @returns code fences in content-block order
 */
export function sourceFencesOfAssistant(blocks: readonly AssistantBlock[]): SourceFence[] {
  const fences: SourceFence[] = []
  for (const block of blocks) {
    if (block.kind === 'text') fences.push(...sourceFencesOf(block.text))
  }
  return fences
}

/**
 * Read the language from the public ChatSnapshot by assistant node key and fence index.
 *
 * @param chat - ChatSnapshot of the current session
 * @param nodeKey - Chat node key for the DOM assistant row
 * @param index - zero-based host code block index within the assistant row
 * @returns the original language; null when the fence has no language, undefined when source is unavailable
 */
export function sourceLanguageAt(chat: ChatSnapshot | undefined, nodeKey: string, index: number): string | null | undefined {
  const node = chat?.nodes.get(nodeKey)
  if (node?.kind !== 'assistant-step') return undefined
  const assistantNode = node as ChatNode<'assistant-step'>
  const fence = sourceFencesOfAssistant(assistantNode.data.blocks)[index]
  return fence?.lang
}
