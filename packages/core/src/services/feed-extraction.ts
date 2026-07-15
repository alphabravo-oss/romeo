import { ApiError } from '../errors'

export interface FeedExtractionResult {
  content: string
  itemCount: number
}

interface FeedItem {
  title: string
  link?: string
  published?: string
  author?: string
  categories: string[]
  enclosures: string[]
  body: string
}

export function extractFeedText(xml: string, maxItemsValue: unknown): FeedExtractionResult {
  const maxItems = normalizeMaxItems(maxItemsValue)
  const blocks = extractElementBlocks(xml, ['item', 'entry']).slice(0, maxItems)
  const lines: string[] = []
  const feedTitle = firstText(firstElementBlock(xml, ['channel', 'feed']) ?? xml, ['title'])
  if (feedTitle !== undefined) lines.push(`# ${markdownLine(feedTitle)}`, '')

  for (const item of blocks.map(parseFeedItem)) {
    lines.push(`## ${markdownLine(item.title)}`)
    if (item.published !== undefined) lines.push(`Published: ${markdownLine(item.published)}`)
    if (item.author !== undefined) lines.push(`Author: ${markdownLine(item.author)}`)
    if (item.categories.length > 0) lines.push(`Categories: ${item.categories.map(markdownLine).join(', ')}`)
    if (item.link !== undefined) lines.push(`Link: ${markdownLine(item.link)}`)
    for (const enclosure of item.enclosures) lines.push(`Enclosure: ${markdownLine(enclosure)}`)
    if (item.body.length > 0) lines.push('', item.body)
    lines.push('')
  }

  if (blocks.length === 0) lines.push(xmlToPlainText(xml))
  const content = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (content.length === 0) throw new ApiError('connector_feed_empty', 'RSS connector feed did not contain indexable text.', 422)
  return { content, itemCount: blocks.length }
}

function parseFeedItem(block: string): FeedItem {
  const link = rssLink(block) ?? atomAlternateLink(block) ?? guidPermalink(block)
  const published = firstText(block, ['pubDate', 'published', 'updated', 'date'])
  const author = itemAuthor(block)
  return {
    title: firstText(block, ['title']) ?? 'Untitled item',
    categories: itemCategories(block),
    enclosures: itemEnclosures(block),
    body: firstText(block, ['encoded', 'content', 'description', 'summary']) ?? '',
    ...(link !== undefined ? { link } : {}),
    ...(published !== undefined ? { published } : {}),
    ...(author !== undefined ? { author } : {})
  }
}

function normalizeMaxItems(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 20
  return Math.min(Math.max(value, 1), 100)
}

function firstElementBlock(xml: string, localNames: string[]): string | undefined {
  return extractElementBlocks(xml, localNames)[0]
}

function extractElementBlocks(xml: string, localNames: string[]): string[] {
  const names = localNames.map(escapeRegex).join('|')
  const pattern = new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?(?:${names}))\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi')
  return [...xml.matchAll(pattern)].map((match) => match[0] ?? '')
}

function firstText(xml: string, localNames: string[]): string | undefined {
  for (const localName of localNames) {
    const text = firstLocalNameText(xml, localName)
    if (text !== undefined) return text
  }
  return undefined
}

function allText(xml: string, localName: string): string[] {
  const pattern = localNamePattern(localName)
  return [...xml.matchAll(pattern)].map((match) => xmlToPlainText(match[2] ?? '')).filter((value) => value.length > 0)
}

function firstLocalNameText(xml: string, localName: string): string | undefined {
  const value = localNamePattern(localName).exec(xml)?.[2]
  if (value === undefined) return undefined
  const text = xmlToPlainText(value)
  return text.length > 0 ? text : undefined
}

function localNamePattern(localName: string): RegExp {
  const name = escapeRegex(localName)
  return new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${name})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi')
}

function rssLink(block: string): string | undefined {
  return firstText(block, ['link'])
}

function atomAlternateLink(block: string): string | undefined {
  const links = startTagAttributes(block, 'link').filter((attrs) => attrs.href !== undefined)
  const alternate = links.find((attrs) => attrs.rel === undefined || attrs.rel === 'alternate')
  return alternate?.href ?? links[0]?.href
}

function guidPermalink(block: string): string | undefined {
  const guidBlock = firstElementBlock(block, ['guid'])
  if (guidBlock === undefined) return undefined
  const guidAttrs = startTagAttributes(guidBlock, 'guid')[0]
  if (guidAttrs?.isPermaLink?.toLowerCase() !== 'true') return undefined
  return firstText(guidBlock, ['guid'])
}

function itemAuthor(block: string): string | undefined {
  const creator = firstText(block, ['creator'])
  if (creator !== undefined) return creator
  const authorBlock = firstElementBlock(block, ['author'])
  if (authorBlock === undefined) return firstText(block, ['author'])
  return firstText(authorBlock, ['name']) ?? firstText(block, ['author'])
}

function itemCategories(block: string): string[] {
  const values = new Set<string>()
  for (const category of allText(block, 'category')) values.add(category)
  for (const attrs of startTagAttributes(block, 'category')) {
    const value = attrs.label ?? attrs.term
    if (value !== undefined && value.length > 0) values.add(value)
  }
  return [...values].slice(0, 12)
}

function itemEnclosures(block: string): string[] {
  const enclosures: string[] = []
  for (const attrs of startTagAttributes(block, 'enclosure')) {
    if (attrs.url === undefined) continue
    enclosures.push(formatEnclosure(attrs.url, attrs.type, attrs.length))
  }
  for (const attrs of startTagAttributes(block, 'link')) {
    if (attrs.href === undefined || attrs.rel !== 'enclosure') continue
    enclosures.push(formatEnclosure(attrs.href, attrs.type, attrs.length))
  }
  return enclosures.slice(0, 5)
}

function formatEnclosure(url: string, type: string | undefined, length: string | undefined): string {
  const details = [type, length === undefined ? undefined : `${length} bytes`].filter((value): value is string => value !== undefined && value.length > 0)
  return details.length > 0 ? `${url} (${details.join(', ')})` : url
}

function startTagAttributes(xml: string, localName: string): Array<Record<string, string | undefined>> {
  const name = escapeRegex(localName)
  const pattern = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}\\b([^>]*)>`, 'gi')
  return [...xml.matchAll(pattern)].map((match) => parseAttributes(match[1] ?? ''))
}

function parseAttributes(source: string): Record<string, string | undefined> {
  const attrs: Record<string, string | undefined> = {}
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.split(':').at(-1)
    if (name === undefined) continue
    attrs[name] = xmlToPlainText(match[3] ?? '')
  }
  return attrs
}

function xmlToPlainText(value: string): string {
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  const withoutUnsafeBlocks = withoutCdata
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  const decoded = decodeXmlEntities(withoutUnsafeBlocks.replace(/<[^>]+>/g, ' '))
  return decoded.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
}

function markdownLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
