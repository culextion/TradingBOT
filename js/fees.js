// ===== Trading Fee Profiles & Slippage Modeling =====
// All fees as decimal fractions (0.01 = 1%)

var FEE_PROFILES = {
  // ---- CRYPTO ----
  coinbase_basic:    { name:'Coinbase (Basic)',       type:'crypto', maker:.006,  taker:.012,  flat:0,    spread:.005, notes:'Entry tier <$10K/mo volume' },
  coinbase_adv:      { name:'Coinbase (Advanced)',    type:'crypto', maker:.004,  taker:.006,  flat:0,    spread:.002, notes:'$10K-$50K volume tier' },
  coinbase_pro:      { name:'Coinbase (High Vol)',    type:'crypto', maker:.0025, taker:.004,  flat:0,    spread:.001, notes:'$50K-$100K volume tier' },
  coinbase_one:      { name:'Coinbase One',           type:'crypto', maker:0,     taker:.0045, flat:0,    spread:.001, notes:'Subscription plan' },
  binance_us:        { name:'Binance.US',             type:'crypto', maker:0,     taker:.0001, flat:0,    spread:.001, notes:'Tier 0 pairs' },
  kraken:            { name:'Kraken',                 type:'crypto', maker:.0026, taker:.0016, flat:0,    spread:.002, notes:'<$50K volume' },
  // ---- STOCKS ----
  alpaca:            { name:'Alpaca',                 type:'stocks', maker:0,     taker:0,     flat:0,    spread:.0005,notes:'Commission-free, 0.25% crypto' },
  robinhood:         { name:'Robinhood',              type:'stocks', maker:0,     taker:0,     flat:0,    spread:.001, notes:'PFOF impact ~0.1-0.5 bps' },
  schwab:            { name:'Schwab / E*TRADE',       type:'stocks', maker:0,     taker:0,     flat:0,    spread:.0003,notes:'$0 commissions, tight spreads' },
  fidelity:          { name:'Fidelity',               type:'stocks', maker:0,     taker:0,     flat:0,    spread:.0003,notes:'$0 commissions' },
  ibkr_lite:         { name:'Interactive Brokers Lite',type:'stocks',maker:0,     taker:0,     flat:0,    spread:.0005,notes:'$0/share US stocks' },
  ibkr_pro:          { name:'Interactive Brokers Pro', type:'stocks',maker:0,     taker:0,     flat:.005, spread:.0003,notes:'$0.005/share, $1 min' },
  webull:            { name:'Webull',                 type:'stocks', maker:0,     taker:0,     flat:0,    spread:.0006,notes:'Regulatory fees apply' },
  // ---- ZERO FEE (for testing) ----
  zero_fee:          { name:'No Fees (Testing)',      type:'both',   maker:0,     taker:0,     flat:0,    spread:0,    notes:'No fees or slippage' },
};

// Slippage model: logarithmic based on order size and volatility
function calculateSlippage(orderSizeUSD, assetVolatility, avgDailyVolume) {
  if (!avgDailyVolume) avgDailyVolume = 1e9; // default to high liquidity
  if (!assetVolatility) assetVolatility = 0.02;
  var baseSpreadBps = 2; // 2 basis points base
  var sizeImpact = Math.log(Math.max(1, orderSizeUSD / avgDailyVolume * 1000)) * 1.5;
  var volMultiplier = 1 + (assetVolatility - 0.02) * 10; // higher vol = more slippage
  var slippageBps = (baseSpreadBps + sizeImpact) * Math.max(0.5, volMultiplier);
  return Math.max(0, slippageBps / 10000); // convert bps to decimal
}

// Calculate total cost of a trade
function calculateTradeCost(orderSizeUSD, profileKey, side, assetVolatility) {
  var profile = FEE_PROFILES[profileKey] || FEE_PROFILES.zero_fee;
  var feeRate = side === 'buy' ? profile.taker : profile.maker; // market orders = taker
  var fees = orderSizeUSD * feeRate;
  var spreadCost = orderSizeUSD * profile.spread;
  var slippage = orderSizeUSD * calculateSlippage(orderSizeUSD, assetVolatility);
  var flatFee = profile.flat;
  return { fees: fees, spread: spreadCost, slippage: slippage, flat: flatFee, total: fees + spreadCost + slippage + flatFee };
}

// Regulatory fees for US stock sells
function calcRegFees(sellAmountUSD) {
  var sec = sellAmountUSD * 0.000008;    // $8 per $1M
  var finra = Math.min(sellAmountUSD * 0.000166, 8.30); // $0.166 per $1K, max $8.30
  return sec + finra;
}

// Format fee detail string for display: "Fee: $60.00 (0.6% taker)"
function formatFeeDetail(cost, orderSizeUSD, side, profileKey) {
  var profile = FEE_PROFILES[profileKey] || FEE_PROFILES.zero_fee;
  var feeRate = side === 'buy' ? profile.taker : profile.maker;
  var feeType = side === 'buy' ? 'taker' : 'maker';
  var pct = (feeRate * 100).toFixed(1);
  return 'Fee: $' + cost.fees.toFixed(2) + ' (' + pct + '% ' + feeType + ')' +
    (cost.spread > 0.01 ? ' + $' + cost.spread.toFixed(2) + ' spread' : '') +
    (cost.slippage > 0.01 ? ' + $' + cost.slippage.toFixed(2) + ' slippage' : '');
}
