export const CHAINS = Object.freeze([
  { id: 1, name: 'Ethereum', symbol: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io',
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  { id: 8453, name: 'Base', symbol: 'ETH', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org' },
  { id: 42161, name: 'Arbitrum One', symbol: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io' },
  { id: 10, name: 'Optimism', symbol: 'ETH', rpc: 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io' }
]);
export function chainById(id) {
  const chain = CHAINS.find(c => c.id === Number(id));
  if (!chain) throw new Error('Unsupported chain.');
  return chain;
}
