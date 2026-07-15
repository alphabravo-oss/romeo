import { describe, expect, it } from 'vitest'

import { ApiError } from '../errors'
import { extractFeedText } from './feed-extraction'

describe('feed extraction', () => {
  it('extracts RSS item metadata and sanitizes HTML-rich bodies', () => {
    const result = extractFeedText(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel>
          <title>Romeo &amp; releases</title>
          <item>
            <title><![CDATA[Connector <update>]]></title>
            <link>https://docs.example.com/releases/connectors?ref=rss&amp;lang=en</link>
            <pubDate>Sat, 27 Jun 2026 12:00:00 GMT</pubDate>
            <dc:creator>Release Engineering</dc:creator>
            <category>connectors</category>
            <category>security</category>
            <enclosure url="https://docs.example.com/audio.mp3" type="audio/mpeg" length="1200" />
            <content:encoded><![CDATA[
              <p>Romeo RSS connector sync imports richer feed entries.</p>
              <script>alert("ignored")</script>
            ]]></content:encoded>
          </item>
        </channel>
      </rss>`,
      10
    )

    expect(result.itemCount).toBe(1)
    expect(result.content).toContain('# Romeo & releases')
    expect(result.content).toContain('## Connector')
    expect(result.content).toContain('Author: Release Engineering')
    expect(result.content).toContain('Categories: connectors, security')
    expect(result.content).toContain('Link: https://docs.example.com/releases/connectors?ref=rss&lang=en')
    expect(result.content).toContain('Enclosure: https://docs.example.com/audio.mp3 (audio/mpeg, 1200 bytes)')
    expect(result.content).toContain('Romeo RSS connector sync imports richer feed entries.')
    expect(result.content).not.toContain('<script')
    expect(result.content).not.toContain('alert')
  })

  it('extracts Atom links, authors, categories, and HTML content', () => {
    const result = extractFeedText(
      `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Romeo engineering</title>
        <entry>
          <title>Atom connector support</title>
          <link rel="self" href="https://docs.example.com/feed.atom" />
          <link rel="alternate" href="https://docs.example.com/blog/atom-connectors" />
          <link rel="enclosure" href="https://docs.example.com/blog/atom-connectors.pdf" type="application/pdf" length="2048" />
          <updated>2026-06-27T13:00:00Z</updated>
          <author><name>Platform Team</name><email>platform@example.com</email></author>
          <category term="feeds" />
          <category label="knowledge sync" term="knowledge-sync" />
          <content type="html">&lt;p&gt;Atom feed extraction keeps connector knowledge sync useful.&lt;/p&gt;</content>
        </entry>
      </feed>`,
      10
    )

    expect(result.itemCount).toBe(1)
    expect(result.content).toContain('# Romeo engineering')
    expect(result.content).toContain('## Atom connector support')
    expect(result.content).toContain('Published: 2026-06-27T13:00:00Z')
    expect(result.content).toContain('Author: Platform Team')
    expect(result.content).toContain('Categories: feeds, knowledge sync')
    expect(result.content).toContain('Link: https://docs.example.com/blog/atom-connectors')
    expect(result.content).toContain('Enclosure: https://docs.example.com/blog/atom-connectors.pdf (application/pdf, 2048 bytes)')
    expect(result.content).toContain('Atom feed extraction keeps connector knowledge sync useful.')
  })

  it('bounds extracted entries and rejects empty feeds', () => {
    const result = extractFeedText(
      `<rss><channel><title>Bounded</title><item><title>First</title></item><item><title>Second</title></item></channel></rss>`,
      1
    )

    expect(result.itemCount).toBe(1)
    expect(result.content).toContain('## First')
    expect(result.content).not.toContain('## Second')
    expect(() => extractFeedText('<rss><channel></channel></rss>', 10)).toThrow(ApiError)
  })
})
