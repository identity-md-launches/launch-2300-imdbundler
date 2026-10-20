// Keep load failures visible even when a transitive module is missing at the gateway.
try {
  await import('./app.js');
  document.documentElement.dataset.appState = 'ready';
} catch {
  document.documentElement.dataset.appState = 'failed';
  const status = document.getElementById('notice');
  status.hidden = false;
  status.setAttribute('role', 'alert');
  status.textContent = 'Wallet tools could not load. Reload this page. If the problem continues, a required site file may be unavailable.';
  const reload = document.createElement('a');
  reload.href = './';
  reload.textContent = 'Reload wallet tools';
  status.append(document.createElement('br'), reload);
  for (const control of document.querySelectorAll('button, input, select, textarea')) control.disabled = true;
}
