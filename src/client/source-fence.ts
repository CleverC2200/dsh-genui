import { fromMarkdown } from 'mdast-util-from-markdown'
import type { AssistantBlock, ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { normalizeFenceLanguage } from '../shared/fence-language.ts'

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

export function sourceFencesOf(markdown: string): SourceFence[] {
  const fences: SourceFence[] = []
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'code') {
      const openingOffset = node.position?.start.offset
      const openingLineEnd = openingOffset === undefined ? -1 : markdown.indexOf('\n', openingOffset)
      const rawLang = node.lang ?? null
      fences.push({
        lang: rawLang === null ? null : normalizeFenceLanguage(rawLang),
        value: node.value as string,
        openingLineComplete: openingLineEnd >= 0,
      })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(fromMarkdown(markdown) as unknown as MarkdownNode)
  return fences
}

export function sourceFencesOfAssistant(blocks: readonly AssistantBlock[]): SourceFence[] {
  const fences: SourceFence[] = []
  for (const block of blocks) {
    if (block.kind === 'text') fences.push(...sourceFencesOf(block.text))
  }
  return fences
}

export function sourceLanguageAt(chat: ChatSnapshot | undefined, nodeKey: string, index: number): string | null | undefined {
  const node = chat?.nodes.get(nodeKey)
  if (node?.kind !== 'assistant-step') return undefined
  const assistantNode = node as ChatNode<'assistant-step'>
  const fence = sourceFencesOfAssistant(assistantNode.data.blocks)[index]
  return fence?.lang
}
