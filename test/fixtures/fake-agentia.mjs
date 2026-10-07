#!/usr/bin/env node
// Stand-in for the real agentia binary, so tests need no Copado org.
import { createInterface } from 'node:readline';
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('fake-agentia/0.0.0'); process.exit(0); }
if (a[0] === 'mcp' && a[1] === 'start') {
  const tools = [
    { name: 'agentia_work_list', description: 'List work', annotations: { readOnlyHint: true } },
    { name: 'agentia_work_create', description: 'Create work', annotations: {} },
    { name: 'agentia_work_delete', description: 'Delete work', annotations: { destructiveHint: true } },
    { name: 'agentia_promotion_run', description: 'Run promotion', annotations: { destructiveHint: true } },
  ];
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  createInterface({ input: process.stdin }).on('line', (l) => {
    const m = JSON.parse(l);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } });
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools } });
    else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `executed:${m.params.name}` }] } });
  });
} else {
  console.log(JSON.stringify({ fake: true, args: a }));
  process.exit(a.includes('--fail') ? 3 : 0);
}
