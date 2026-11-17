#!/usr/bin/env node
// Nachgebaute Tailscale-Kommandozeile für Tests (Ausgaben wie tailscale 1.8x)
const fs = require('fs');
const state = process.env.FAKE_TS_STATE_FILE;
const cur = () => { try { return fs.readFileSync(state, 'utf8'); } catch { return 'NeedsLogin'; } };
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'status') {
  const running = cur() === 'Running';
  console.log(JSON.stringify({
    BackendState: cur(), AuthURL: running ? '' : 'https://login.tailscale.com/a/abc123',
    Self: { HostName: 'alegamestation', DNSName: 'alegamestation.tail1234.ts.net.', TailscaleIPs: running ? ['100.64.0.5'] : [], UserID: 1 },
    User: { 1: { LoginName: 'ale@example.com' } }, CurrentTailnet: { Name: 'ale@example.com' },
    Peer: { a: { HostName: 'romm-server', DNSName: 'romm-server.tail1234.ts.net.', TailscaleIPs: ['100.64.0.9'], Online: true, OS: 'linux' },
            b: { HostName: 'handy', DNSName: 'handy.tail1234.ts.net.', TailscaleIPs: ['100.64.0.7'], Online: false, OS: 'android' } }
  }));
} else if (cmd === 'up') {
  if (!rest.includes('--json')) process.exit(2);
  console.log(JSON.stringify({ AuthURL: 'https://login.tailscale.com/a/abc123', QR: 'data:image/png;base64,iVBORw0KGgo=', BackendState: 'NeedsLogin' }, null, 2));
  setTimeout(() => { fs.writeFileSync(state, 'Running'); console.log(JSON.stringify({ BackendState: 'Running' })); process.exit(0); }, 300);
} else if (cmd === 'down') { fs.writeFileSync(state, 'Stopped'); }
