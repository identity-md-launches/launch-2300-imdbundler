import { Vault } from './vault.js';
import { CHAINS, chainById } from './chains.js';
import { fundingPlan, tokenPlan, nftMintPlan, contractPlan, publicBundle, profitLoss, address, amount, v2, erc20 } from './transactions.js';
import { rpc, verifyChain, requireCode, simulate, sendWithProvider } from './rpc.js';
import { formatEther, formatUnits, Interface } from './vendor/ethers.js';

const $ = id => document.getElementById(id);
const vault = new Vault();
const selected = new Set();
const providers = new Map();
const balances = new Map();
let bundle = null, deployment = null, working = false, cardReady = false;
let dialogResolve;
const txStatus = new Map();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(message) { $('notice').hidden = false; $('notice').textContent = message; }
function currentChain() { return chainById(Number($('chain').value)); }
function selectedWallets() {
  const wallets = vault.addresses.filter(a => selected.has(a));
  if (!wallets.length) throw new Error('Select at least one wallet in Manage.');
  return wallets;
}
function busy(on) {
  working = on;
  for (const element of document.querySelectorAll('button,input,select,textarea')) {
    if (element.closest('dialog')) continue;
    element.disabled = on;
  }
  document.body.setAttribute('aria-busy', String(on));
  if (!on) for (const [i, status] of txStatus) {
    if (status.hash) document.querySelector(`[data-send="${i}"]`)?.setAttribute('disabled', '');
  }
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    if (working) return;
    busy(true);
    try { await fn(); }
    catch (error) { notice(error instanceof Error ? error.message : 'The action failed. Please try again.'); }
    finally { busy(false); }
  });
}
function review(title, content, confirmText = 'CONFIRM') {
  $('dialog-title').textContent = title; $('dialog-content').textContent = content;
  $('dialog-confirm').textContent = confirmText;
  $('review-dialog').showModal();
  return new Promise(resolve => { dialogResolve = resolve; });
}
function endReview(result) { $('review-dialog').close(); dialogResolve?.(result); dialogResolve = null; }
$('dialog-cancel').addEventListener('click', () => endReview(false));
$('dialog-confirm').addEventListener('click', () => endReview(true));
$('review-dialog').addEventListener('cancel', event => { event.preventDefault(); endReview(false); });
function download(content, name, mime = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: mime }));
  const link = node('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copy(text) {
  if (!navigator.clipboard) throw new Error('Clipboard unavailable. Select and copy the displayed text, or download the file.');
  await navigator.clipboard.writeText(text); notice('Copied.');
}
function page() {
  const id = location.hash.slice(1) || 'home';
  const name = ['home', 'manage', 'snipe', 'pnl', 'token'].includes(id) ? id : 'home';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== name;
  for (const link of document.querySelectorAll('[data-page]')) {
    if (link.dataset.page === name) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  $('transaction-panel').hidden = !bundle || !['snipe', 'manage'].includes(name);
}
window.addEventListener('hashchange', page);
function resetPlan() { bundle = null; txStatus.clear(); $('transactions').replaceChildren(); page(); }
function renderWallets() {
  $('nav-count').textContent = String(vault.count);
  $('wallet-summary').textContent = vault.count ? `${vault.count} wallets in memory / ${selected.size} selected / ${currentChain().name}` : 'No wallets loaded. Generate or restore a fleet on Home.';
  $('selected-count').textContent = `${selected.size} selected — choose wallets in Manage`;
  $('wallet-list').replaceChildren(); $('keystore-wallet').replaceChildren();
  vault.addresses.forEach((wallet, index) => {
    const row = node('article', null, 'wallet'), checkbox = node('input');
    checkbox.type = 'checkbox'; checkbox.checked = selected.has(wallet); checkbox.setAttribute('aria-label', `Select wallet ${index + 1}`);
    checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(wallet) : selected.delete(wallet); resetPlan(); renderWallets(); });
    const text = node('div', wallet, 'wallet-address');
    text.append(node('span', balances.get(wallet) ?? `${currentChain().symbol} balance not fetched`, 'balance'));
    const copyButton = node('button', 'COPY');
    copyButton.addEventListener('click', () => copy(wallet).catch(e => notice(e.message)));
    row.append(checkbox, node('span', `#${String(index + 1).padStart(2, '0')}`, 'wallet-id'), text, copyButton);
    $('wallet-list').append(row);
    const option = node('option', `#${index + 1} · ${wallet.slice(0, 10)}…${wallet.slice(-6)}`); option.value = index; $('keystore-wallet').append(option);
  });
  if (!vault.count) { const option = node('option', 'No wallets'); option.value = ''; $('keystore-wallet').append(option); }
}
function loadFleet(addresses) {
  selected.clear(); addresses.forEach(a => selected.add(a)); balances.clear(); resetPlan(); renderWallets(); location.hash = 'manage';
  notice(`${addresses.length} wallets ready. Export an encrypted backup before funding them.`);
}
action('generate', () => loadFleet(vault.generate(Number($('wallet-count').value))));
action('restore', async () => {
  const file = $('restore-file').files[0];
  if (!file || file.size > 100_000) throw new Error('Choose an imdbundler encrypted JSON file under 100 KB.');
  try { loadFleet(await vault.restore(await file.text(), $('restore-password').value)); }
  finally { $('restore-password').value = ''; $('restore-file').value = ''; }
});
function exportPassword() {
  if ($('export-password').value !== $('export-confirm').value) throw new Error('The passwords do not match.');
  return $('export-password').value;
}
function clearExportPasswords() { $('export-password').value = ''; $('export-confirm').value = ''; }
action('export', async () => {
  try { download(await vault.encrypt(exportPassword()), 'imdbundler-encrypted-fleet.json'); notice('Encrypted backup downloaded. Store it safely and verify restoration before funding.'); }
  finally { clearExportPasswords(); }
});
action('export-keystore', async () => {
  if ($('keystore-wallet').value === '') throw new Error('Choose a wallet.');
  notice('Encrypting a Web3 keystore locally. This may take a few seconds.');
  const index = Number($('keystore-wallet').value);
  try { download(await vault.keystore(index, exportPassword()), `imdbundler-wallet-${index + 1}-keystore.json`); notice('Encrypted Web3 keystore downloaded. Import it only into your trusted compatible signer.'); }
  finally { clearExportPasswords(); }
});
action('clear', async () => {
  if (!await review('Clear all wallets?', 'This removes the in-memory wallets, selections, passwords and transaction plan. Download and verify an encrypted backup first. This is not a guaranteed memory wipe.', 'CLEAR WALLET MEMORY')) return;
  vault.clear(); selected.clear(); balances.clear(); resetPlan(); clearExportPasswords();
  $('restore-password').value = ''; $('restore-file').value = ''; providers.clear(); discoverRequested = false; renderProviders(); renderWallets();
  notice('Wallet memory and prepared transactions cleared. Encrypted downloads remain on your device.');
});
action('select-all', () => { vault.addresses.forEach(a => selected.add(a)); resetPlan(); renderWallets(); });
action('select-none', () => { selected.clear(); resetPlan(); renderWallets(); });
for (const chain of CHAINS) { const option = node('option', `${chain.name} / ${chain.id}`); option.value = chain.id; $('chain').append(option); }
$('rpc-url').value = CHAINS[0].rpc;
$('chain').addEventListener('change', () => {
  $('rpc-url').value = currentChain().rpc; $('network-name').textContent = `${currentChain().name} / chain ${currentChain().id}`;
  balances.clear(); resetPlan(); renderWallets(); $('quote-info').textContent = 'Network changed. Request a fresh quote before preparing a token buy.';
});
$('rpc-url').addEventListener('change', () => { balances.clear(); renderWallets(); resetPlan(); });
$('balance-token').addEventListener('change', () => { balances.clear(); renderWallets(); });
action('refresh-balances', async () => {
  if (!vault.count) throw new Error('Generate or restore wallets first.');
  const chain = currentChain(), url = $('rpc-url').value;
  await verifyChain(url, chain.id);
  const target = $('balance-token').value.trim() ? address($('balance-token').value) : null;
  let decimals;
  if (target) {
    await requireCode(url, target);
    decimals = Number(erc20.decodeFunctionResult('decimals', await rpc(url, 'eth_call', [{ to: target, data: erc20.encodeFunctionData('decimals') }, 'latest']))[0]);
    if (decimals > 36) throw new Error('Token decimals above 36 are not supported by this UI.');
  }
  let failed = 0;
  // Four in flight at most. Stop after a failed batch instead of waiting through 50 timeouts.
  const wallets = vault.addresses;
  for (let offset = 0; offset < wallets.length; offset += 4) {
    const results = await Promise.all(wallets.slice(offset, offset + 4).map(async wallet => {
      try {
        let text = `${formatEther(BigInt(await rpc(url, 'eth_getBalance', [wallet, 'latest'])))} ${chain.symbol}`;
        if (target) {
          const result = await rpc(url, 'eth_call', [{ to: target, data: erc20.encodeFunctionData('balanceOf', [wallet]) }, 'latest']);
          text += ` / ${formatUnits(erc20.decodeFunctionResult('balanceOf', result)[0], decimals)} token`;
        }
        balances.set(wallet, text);
        return true;
      } catch { failed++; balances.set(wallet, 'RPC unavailable — balance unknown'); return false; }
    }));
    if (results.some(ok => !ok)) {
      for (const wallet of wallets.slice(offset + 4)) { balances.set(wallet, 'Not read — RPC unavailable'); failed++; }
      break;
    }
  }
  renderWallets(); notice(`Balances refreshed on ${chain.name}.${failed ? ` ${failed} wallets could not be read; no zero balances were assumed.` : ''}`);
});
function setPlan(transactions, kind, expiresAt = new Date(Date.now() + 600_000).toISOString()) {
  bundle = publicBundle(transactions, kind, undefined, expiresAt); txStatus.clear(); renderPlan(); page();
  $('transaction-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
action('prepare-funding', () => {
  const wallets = selectedWallets();
  const transactions = fundingPlan({ wallets, from: $('fund-from').value, value: $('fund-amount').value, chainId: currentChain().id });
  $('fund-total').textContent = `${formatEther(amount($('fund-amount').value) * BigInt(wallets.length))} ETH total, plus a separate gas fee for each transfer.`;
  setPlan(transactions, 'native-funding');
});
function modeChanged() {
  $('token-fields').hidden = $('buy-mode').value !== 'token';
  $('mint-fields').hidden = $('buy-mode').value !== 'mint';
  $('raw-fields').hidden = $('buy-mode').value !== 'raw';
  $('review-target').checked = false; resetPlan();
}
$('buy-mode').addEventListener('change', modeChanged);
for (const id of ['target', 'buy-value', 'min-output', 'token-decimals', 'deadline', 'mint-quantity', 'mint-signature', 'calldata', 'fund-from', 'fund-amount']) {
  $(id).addEventListener('input', () => { resetPlan(); $('review-target').checked = false; });
}
async function tokenMetadata(url, chain, token) {
  if (!chain.router) throw new Error('The built-in token route supports Ethereum only.');
  await requireCode(url, token); await requireCode(url, chain.router);
  const wrapped = v2.decodeFunctionResult('WETH', await rpc(url, 'eth_call', [{ to: chain.router, data: v2.encodeFunctionData('WETH') }, 'latest']))[0];
  if (address(wrapped) !== address(chain.wrapped)) throw new Error('Router WETH does not match the expected chain deployment.');
  return Number(erc20.decodeFunctionResult('decimals', await rpc(url, 'eth_call', [{ to: token, data: erc20.encodeFunctionData('decimals') }, 'latest']))[0]);
}
action('quote', async () => {
  resetPlan();
  const chain = currentChain(), url = $('rpc-url').value, token = address($('target').value), wei = amount($('buy-value').value);
  const slippage = Number($('slippage').value);
  if (!Number.isFinite(slippage) || slippage < 0.01 || slippage > 5) throw new Error('Choose slippage between 0.01% and 5%.');
  await verifyChain(url, chain.id);
  const decimals = await tokenMetadata(url, chain, token);
  if (decimals > 36) throw new Error('Token decimals above 36 are not supported.');
  const response = await rpc(url, 'eth_call', [{ to: chain.router, data: v2.encodeFunctionData('getAmountsOut', [wei, [chain.wrapped, token]]) }, 'latest']);
  const amounts = v2.decodeFunctionResult('getAmountsOut', response)[0];
  if (amounts.length !== 2 || amounts[0] !== wei) throw new Error('Unexpected quote response.');
  const minimum = amounts[1] * BigInt(10_000 - Math.round(slippage * 100)) / 10_000n;
  if (!minimum) throw new Error('Quote is too small.');
  $('token-decimals').value = decimals; $('min-output').value = formatUnits(minimum, decimals);
  $('quote-info').textContent = `Indicative output: ${formatUnits(amounts[1], decimals)} tokens. Minimum: ${formatUnits(minimum, decimals)}. Quote time: ${new Date().toLocaleTimeString()}. Each wallet needs a fresh simulation; the quote does not include token transfer taxes. The router enforces the minimum against tokens actually received.`;
  notice('Quote loaded. Check the amounts before preparing.');
});
action('prepare-buy', async () => {
  if (!$('review-target').checked) throw new Error('Confirm that you reviewed the target and its interface.');
  const wallets = selectedWallets(), chain = currentChain(), target = address($('target').value), url = $('rpc-url').value;
  await verifyChain(url, chain.id); await requireCode(url, target);
  const common = { wallets, chainId: chain.id, value: $('buy-value').value };
  const mode = $('buy-mode').value;
  let transactions, expires = new Date(Date.now() + 600_000).toISOString();
  if (mode === 'token') {
    const minutes = Number($('deadline').value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error('Deadline must be 1–60 minutes.');
    const decimals = await tokenMetadata(url, chain, target);
    if (decimals !== Number($('token-decimals').value)) throw new Error(`On-chain decimals are ${decimals}. Correct the decimals and minimum amount first.`);
    const deadline = Math.floor(Date.now() / 1000) + minutes * 60;
    transactions = tokenPlan({ ...common, token: target, minimum: $('min-output').value, decimals, deadline });
    expires = new Date(deadline * 1000).toISOString();
  } else if (mode === 'mint') transactions = nftMintPlan({ ...common, target, quantity: Number($('mint-quantity').value), signature: $('mint-signature').value });
  else transactions = contractPlan({ ...common, target, data: $('calldata').value.trim() });
  setPlan(transactions, mode === 'token' ? 'uniswap-v2-buy' : mode === 'mint' ? 'nft-mint' : 'reviewed-contract-call', expires);
});
function checkPlan() {
  if (!bundle) throw new Error('Prepare a plan first.');
  if (new Date(bundle.expiresAt).getTime() <= Date.now()) throw new Error('This plan has expired. Prepare a fresh plan before signing.');
  if (Number(BigInt(bundle.transactions[0].chainId)) !== currentChain().id) throw new Error('Network changed. Prepare a fresh plan.');
}
function renderPlan() {
  $('transactions').replaceChildren();
  $('plan-description').textContent = `${bundle.kind} / ${bundle.transactions.length} independent transactions / ${currentChain().name}. Plan expires ${new Date(bundle.expiresAt).toLocaleTimeString()}. Nonces and gas are assigned by your signer. Simulations do not guarantee future execution.`;
  bundle.transactions.forEach((transaction, index) => {
    const row = node('article', null, 'transaction');
    row.append(node('h3', `TX ${String(index + 1).padStart(2, '0')} / ${formatEther(BigInt(transaction.value))} ETH`));
    row.append(node('p', `FROM ${transaction.from}\nTO ${transaction.to}`, 'small'));
    const details = node('details'); details.append(node('summary', 'Inspect full transaction fields'), node('pre', JSON.stringify(transaction, null, 2))); row.append(details);
    const status = node('p', 'Unsigned / not simulated', 'transaction-status');
    const copyButton = node('button', 'COPY TX'); copyButton.addEventListener('click', () => copy(JSON.stringify(transaction, null, 2)).catch(e => notice(e.message)));
    const simulateButton = node('button', 'SIMULATE');
    simulateButton.addEventListener('click', async () => {
      if (working) return; busy(true);
      try {
        checkPlan(); const result = await simulate($('rpc-url').value, transaction);
        status.textContent = `Simulation passed at ${new Date(result.checkedAt).toLocaleTimeString()} / estimated gas ${BigInt(result.gas)}. Not a guarantee.`;
      } catch (error) { status.textContent = `Simulation failed: ${error.message}`; notice('Simulation failed. Inspect the transaction and funding before signing.'); }
      finally { busy(false); }
    });
    const sendButton = node('button', 'SIGN IN CHOSEN EXTENSION'); sendButton.dataset.send = index;
    sendButton.addEventListener('click', async () => {
      if (working || txStatus.get(index)?.hash) return; busy(true);
      try {
        checkPlan();
        const chosen = providers.get($('extension').value);
        if (!chosen) throw new Error('Discover extensions and explicitly choose one first.');
        if (!await review('Request one external signature?', `${chosen.name}\n${currentChain().name}\n\n${JSON.stringify(transaction, null, 2)}\n\nThe extension must control this exact sender. Inspect its confirmation before signing.`, 'SIMULATE & REQUEST SIGNATURE')) return;
        checkPlan(); await simulate($('rpc-url').value, transaction); checkPlan();
        const hash = await sendWithProvider(chosen.provider, transaction);
        if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('The wallet returned an unexpected result. Check it before retrying.');
        txStatus.set(index, { hash }); status.textContent = `Submitted: ${hash}. Check final receipt in your extension. Submission does not mean confirmed.`;
      } catch (error) { notice(error.message); }
      finally { busy(false); }
    });
    row.append(copyButton, simulateButton, sendButton, status); $('transactions').append(row);
  });
}
action('download-plan', () => { checkPlan(); download(JSON.stringify(bundle, null, 2), 'imdbundler-unsigned-plan.json'); });
action('copy-plan', () => { checkPlan(); return copy(JSON.stringify(bundle, null, 2)); });
action('discard-plan', () => { resetPlan(); notice('Plan discarded.'); });
function renderProviders() {
  const previous = $('extension').value; $('extension').replaceChildren();
  const empty = node('option', 'Choose an extension'); empty.value = ''; $('extension').append(empty);
  for (const [id, item] of providers) { const option = node('option', item.name); option.value = id; $('extension').append(option); }
  if (providers.has(previous)) $('extension').value = previous;
}
let discoverRequested = false;
window.addEventListener('eip6963:announceProvider', event => {
  if (!discoverRequested) return;
  const detail = event.detail;
  if (!detail || typeof detail.info?.uuid !== 'string' || typeof detail.info?.name !== 'string' || typeof detail.provider?.request !== 'function') return;
  if (providers.size >= 20 || detail.info.uuid.length > 100) return;
  providers.set(detail.info.uuid, { name: detail.info.name.slice(0, 60), provider: detail.provider }); renderProviders();
});
action('discover-wallets', () => {
  discoverRequested = true; providers.clear(); renderProviders(); window.dispatchEvent(new Event('eip6963:requestProvider'));
  notice('Wallet discovery requested. Choose an extension by name; no accounts have been requested. If none appears, use your own external signing tool.');
});

const money = value => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8, notation: Math.abs(value) >= 1e12 || (Math.abs(value) > 0 && Math.abs(value) < 1e-6) ? 'scientific' : 'standard' }).format(value);
async function renderPnl() {
  cardReady = false;
  const values = profitLoss({ entry: $('pnl-entry').value, exit: $('pnl-exit').value, quantity: $('pnl-quantity').value, percent: $('pnl-percent').value });
  const canvas = $('pnl-canvas'), ctx = canvas.getContext('2d');
  const frog = new Image(); frog.src = `./assets/pepe-${values.pose}.svg`; await frog.decode();
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1200, 800); ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 3; ctx.strokeRect(28, 28, 1144, 744);
  ctx.fillStyle = '#00ff00'; ctx.font = 'bold 32px monospace'; ctx.fillText('imdbundler_', 65, 100);
  ctx.font = '20px monospace'; ctx.fillText('PEPE P&L / SELF-REPORTED', 65, 150);
  ctx.font = 'bold 90px monospace'; ctx.fillText(`${values.gain >= 0 ? '+' : ''}${money(values.gain)}%`, 65, 320, 750);
  ctx.font = 'bold 45px monospace'; ctx.fillText(`${values.pnl >= 0 ? '+' : ''}${money(values.pnl)} P&L`, 65, 400, 700);
  ctx.drawImage(frog, 790, 220, 340, 340);
  ctx.font = '22px monospace'; ctx.fillText(`ENTRY  ${money(values.entry)}`, 65, 550, 650); ctx.fillText(`EXIT   ${money(values.exit)}`, 65, 595, 650); ctx.fillText(`AMOUNT ${money(values.quantity)}`, 65, 640, 650);
  ctx.font = '18px monospace'; ctx.fillText('USER-ENTERED / EXCLUDES FEES / NOT VERIFIED PERFORMANCE', 65, 735, 1060);
  $('pnl-description').textContent = `${values.gain >= 0 ? '+' : ''}${money(values.gain)}% / P&L ${money(values.pnl)} in your chosen quote currency. ${values.pose} frog.`;
  cardReady = true;
}
for (const id of ['pnl-entry', 'pnl-exit', 'pnl-quantity', 'pnl-percent']) $(id).addEventListener('input', () => { cardReady = false; });
action('render-pnl', renderPnl);
action('download-pnl', async () => {
  if (!cardReady) await renderPnl();
  const blob = await new Promise(resolve => $('pnl-canvas').toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export failed.');
  download(blob, 'imdbundler-pepe-pnl.png', 'image/png');
});
const hookRead = new Interface(['function token() view returns(address)', 'function totalFeesIMD() view returns(uint256)', 'function totalBuybackIMD() view returns(uint256)', 'function totalBurned() view returns(uint256)', 'function pendingIMD() view returns(uint256)', 'function pendingIMDB() view returns(uint256)']);
async function loadDeployment() {
  try {
    const response = await fetch('./deployment.json', { credentials: 'omit', cache: 'no-store' });
    const file = await response.json();
    if (file.status !== 'deployed' || file.chainId !== 1) return;
    const token = address(file.token), hook = address(file.hook);
    deployment = { token, hook };
    $('launch-status').textContent = 'Deployment addresses supplied by the launch release. Verify bytecode and source before using them.';
    for (const [label, value] of [['Token', token], ['Hook', hook]]) {
      const link = node('a', value); link.href = `https://etherscan.io/address/${value}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const dd = node('dd'); dd.append(link); $('deployment-details').append(node('dt', label), dd);
    }
    if (typeof file.sourceUrl === 'string') {
      const url = new URL(file.sourceUrl);
      if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password) {
        const link = node('a', 'Launch source on GitHub'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const dd = node('dd'); dd.append(link); $('deployment-details').append(node('dt', 'Source'), dd);
      }
    }
  } catch { $('launch-status').textContent = 'Deployment information unavailable. No live addresses have been assumed.'; }
}
action('burn-stats', async () => {
  if (!deployment) throw new Error('Live stats are unavailable until the verified deployment addresses are published.');
  if (currentChain().id !== 1) throw new Error('Select Ethereum in network settings to read IMDB launch stats.');
  const url = $('rpc-url').value;
  await verifyChain(url, 1); await requireCode(url, deployment.token); await requireCode(url, deployment.hook);
  const callHook = async method => hookRead.decodeFunctionResult(method, await rpc(url, 'eth_call', [{ to: deployment.hook, data: hookRead.encodeFunctionData(method) }, 'latest']))[0];
  if (address(await callHook('token')) !== deployment.token) throw new Error('Hook token does not match the configured token.');
  const lines = [];
  for (const [method, label, unit] of [['totalFeesIMD', 'Fees collected', 'IMD'], ['totalBuybackIMD', 'Buybacks spent', 'IMD'], ['totalBurned', 'Burned by hook', 'IMDB'], ['pendingIMD', 'Awaiting buyback', 'IMD'], ['pendingIMDB', 'Awaiting burn', 'IMDB']]) {
    lines.push(`${label}: ${formatUnits(await callHook(method), 18)} ${unit}`);
  }
  const supply = erc20.decodeFunctionResult('totalSupply', await rpc(url, 'eth_call', [{ to: deployment.token, data: erc20.encodeFunctionData('totalSupply') }, 'latest']))[0];
  lines.push(`Current supply: ${formatUnits(supply, 18)} IMDB`, `Read at ${new Date().toISOString()}`);
  $('burn-output').textContent = lines.join('\n');
});
window.addEventListener('beforeunload', event => { if (vault.count) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { vault.clear(); selected.clear(); balances.clear(); bundle = null; providers.clear(); discoverRequested = false; txStatus.clear(); clearExportPasswords(); $('restore-password').value = ''; });
window.addEventListener('pageshow', event => { if (event.persisted) { renderProviders(); renderWallets(); resetPlan(); notice('Wallet memory cleared when leaving the page. Restore your encrypted backup to continue.'); } });
page(); renderWallets(); modeChanged();
renderPnl().catch(() => notice('Card preview unavailable. Use Render Card to try again.'));
loadDeployment();
