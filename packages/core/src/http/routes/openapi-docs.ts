import type { RomeoApi } from '../context'

export function registerOpenApiDocsRoute(app: RomeoApi): void {
  app.get('/api/v1/docs', (context) => context.html(openApiDocsHtml))
}

const openApiDocsHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Romeo API Docs</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23101820'/%3E%3Cpath d='M18 46V18h6v11h16V18h6v28h-6V35H24v11z' fill='%23f5f7fb'/%3E%3C/svg%3E" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { color: #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f8fafc; }
      main { max-width: 1120px; margin: 0 auto; padding: 28px 20px 40px; }
      header { display: grid; gap: 8px; margin-bottom: 18px; }
      h1 { font-size: 28px; line-height: 1.15; margin: 0; }
      p { color: #475569; margin: 0; }
      .toolbar { align-items: center; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) auto; margin: 18px 0; }
      .search { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; color: #0f172a; font: inherit; min-height: 42px; padding: 9px 12px; width: 100%; }
      .count { color: #475569; font-size: 13px; white-space: nowrap; }
      .table-wrap { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #e2e8f0; padding: 11px 12px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; color: #334155; font-size: 12px; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
      code { color: #0f172a; overflow-wrap: anywhere; }
      .method { border-radius: 999px; color: #ffffff; display: inline-block; font-size: 12px; font-weight: 800; min-width: 58px; padding: 4px 8px; text-align: center; text-transform: uppercase; }
      .method-get { background: #2563eb; }
      .method-post { background: #059669; }
      .method-patch { background: #7c3aed; }
      .method-put { background: #d97706; }
      .method-delete { background: #dc2626; }
      .tag { color: #64748b; display: block; font-size: 12px; margin-top: 4px; }
      .empty { color: #64748b; padding: 28px 12px; text-align: center; }
      @media (max-width: 720px) {
        main { padding: 20px 12px 32px; }
        .toolbar { grid-template-columns: 1fr; }
        .count { white-space: normal; }
        th:nth-child(4), td:nth-child(4) { display: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Romeo API Docs</h1>
        <p id="description">Loading OpenAPI document...</p>
      </header>
      <div class="toolbar">
        <input id="search" class="search" type="search" placeholder="Search endpoints" autocomplete="off" />
        <span id="count" class="count"></span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Summary</th><th>Tag</th></tr></thead>
          <tbody id="paths"></tbody>
        </table>
        <div id="empty" class="empty" hidden>No matching endpoints.</div>
      </div>
    </main>
    <script>
      const rows = [];

      async function renderDocs() {
        const response = await fetch('/api/v1/openapi.json', { headers: { accept: 'application/json' } });
        const spec = await response.json();
        document.getElementById('description').textContent = spec.info.title + ' ' + spec.info.version + ' · ' + Object.keys(spec.paths).length + ' paths';
        for (const path of Object.keys(spec.paths).sort()) {
          for (const method of Object.keys(spec.paths[path]).sort()) {
            const operation = spec.paths[path][method];
            rows.push({
              method,
              path,
              summary: operation.summary || '',
              tag: Array.isArray(operation.tags) && operation.tags.length > 0 ? operation.tags[0] : ''
            });
          }
        }
        renderRows(rows);
        document.getElementById('search').addEventListener('input', filterRows);
      }

      function filterRows() {
        const query = document.getElementById('search').value.trim().toLowerCase();
        if (query.length === 0) {
          renderRows(rows);
          return;
        }
        renderRows(rows.filter((row) => [row.method, row.path, row.summary, row.tag].join(' ').toLowerCase().includes(query)));
      }

      function renderRows(visibleRows) {
        const body = document.getElementById('paths');
        body.replaceChildren();
        for (const row of visibleRows) {
          const tr = document.createElement('tr');
          const method = document.createElement('td');
          const path = document.createElement('td');
          const summary = document.createElement('td');
          const tag = document.createElement('td');
          const badge = document.createElement('span');
          const code = document.createElement('code');
          badge.className = 'method method-' + row.method.toLowerCase();
          badge.textContent = row.method;
          method.appendChild(badge);
          code.textContent = row.path;
          path.appendChild(code);
          summary.textContent = row.summary;
          tag.textContent = row.tag;
          tr.append(method, path, summary, tag);
          body.appendChild(tr);
        }
        document.getElementById('count').textContent = visibleRows.length + ' of ' + rows.length + ' operations';
        document.getElementById('empty').hidden = visibleRows.length !== 0;
      }

      renderDocs().catch(() => {
        document.getElementById('description').textContent = 'Unable to load OpenAPI document.';
      });
    </script>
  </body>
</html>`
