import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Asset ID to symbol mapping
const ASSET_MAP: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
  ripple: 'XRP',
  cardano: 'ADA',
}

// CoinGecko price fetch
async function fetchPrices(): Promise<Record<string, { usd: number; usd_24h_change: number }>> {
  const ids = Object.keys(ASSET_MAP).join(',')
  const resp = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  )
  if (!resp.ok) throw new Error(`CoinGecko API error: ${resp.status}`)
  return await resp.json()
}

// Calculate RSI from close prices (Wilder's smoothed RSI)
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff; else losses -= diff
  }
  let avgGain = gains / period, avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

// Calculate Simple Moving Average
function calcSMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1]
  const slice = closes.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

// Generate signals for an asset
function analyzeAsset(closes: number[], currentPrice: number, change24h: number) {
  const signals: Array<{ dir: string; reason: string; conf: number; strat: string }> = []
  const rsi = calcRSI(closes)
  const sma20 = calcSMA(closes, 20)
  const sma50 = calcSMA(closes, 50)

  // RSI signals
  if (rsi < 25) {
    signals.push({ dir: 'buy', reason: `RSI=${rsi.toFixed(0)} deeply oversold`, conf: 80, strat: 'meanrev' })
  } else if (rsi < 35) {
    signals.push({ dir: 'buy', reason: `RSI=${rsi.toFixed(0)} oversold`, conf: 70, strat: 'meanrev' })
  }
  if (rsi > 75) {
    signals.push({ dir: 'sell', reason: `RSI=${rsi.toFixed(0)} overbought`, conf: 78, strat: 'meanrev' })
  }

  // SMA crossover signals
  if (currentPrice > sma20 && sma20 > sma50 && change24h > 0.5) {
    signals.push({ dir: 'buy', reason: 'Uptrend: price > SMA20 > SMA50', conf: 72, strat: 'momentum' })
  }
  if (currentPrice < sma20 && sma20 < sma50 && change24h < -0.5) {
    signals.push({ dir: 'sell', reason: 'Downtrend: price < SMA20 < SMA50', conf: 70, strat: 'momentum' })
  }

  // Bollinger Bands
  if (closes.length >= 20) {
    const slice = closes.slice(-20)
    const mean = slice.reduce((a, b) => a + b, 0) / 20
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20)
    if (currentPrice < mean - 1.8 * std) {
      signals.push({ dir: 'buy', reason: 'Price below lower Bollinger Band', conf: 68, strat: 'bollinger' })
    }
    if (currentPrice > mean + 1.8 * std) {
      signals.push({ dir: 'sell', reason: 'Price above upper Bollinger Band', conf: 66, strat: 'bollinger' })
    }
  }

  return signals
}

Deno.serve(async (_req) => {
  const startTime = Date.now()
  try {
    // 1. Fetch current prices from CoinGecko
    let prices: Record<string, { usd: number; usd_24h_change: number }>
    try {
      prices = await fetchPrices()
    } catch (e) {
      console.error('Price fetch failed:', e)
      return new Response(
        JSON.stringify({ error: 'Price fetch failed', detail: (e as Error).message }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 2. Get all users with server bot enabled
    const { data: users, error: usersError } = await supabase
      .from('user_settings')
      .select('user_id, bot_strategy, risk_config, fee_profile')
      .eq('server_bot_enabled', true)

    if (usersError) {
      console.error('Users query error:', usersError)
      return new Response(
        JSON.stringify({ error: 'Failed to query users', detail: usersError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No users with server bot enabled', timestamp: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const results: Array<Record<string, unknown>> = []

    for (const user of users) {
      try {
        // 3. Load user's active paper account
        const { data: accounts } = await supabase
          .from('paper_accounts')
          .select('*')
          .eq('user_id', user.user_id)
          .eq('is_active', true)
          .limit(1)

        if (!accounts || !accounts.length) continue
        const account = accounts[0]

        // 4. Load existing positions
        const { data: positions } = await supabase
          .from('positions')
          .select('*')
          .eq('user_id', user.user_id)
          .eq('account_id', account.id)

        // 5. Risk config with defaults
        const riskConfig = {
          positionSizePct: 10,
          stopLossPct: 5,
          takeProfitPct: 10,
          maxPositions: 5,
          ...(user.risk_config || {}),
        }

        let cash = Number(account.cash)

        // 6. Check stop-loss / take-profit on existing positions
        for (const pos of (positions || [])) {
          const priceData = prices[pos.asset_id]
          if (!priceData?.usd) continue
          const price = priceData.usd
          const avgPrice = Number(pos.avg_price)
          const pctChange = (price - avgPrice) / avgPrice

          if (pctChange <= -(riskConfig.stopLossPct / 100)) {
            // STOP LOSS — sell entire position
            const qty = Number(pos.quantity)
            const proceeds = qty * price
            const pnl = proceeds - qty * avgPrice
            const sym = ASSET_MAP[pos.asset_id] || pos.symbol || pos.asset_id.toUpperCase()

            await supabase.from('positions').delete().eq('id', pos.id)
            await supabase.from('paper_accounts').update({ cash: cash + proceeds }).eq('id', account.id)
            cash += proceeds

            await supabase.from('trades').insert({
              user_id: user.user_id, account_id: account.id,
              asset_id: pos.asset_id, symbol: sym, side: 'SELL',
              quantity: qty, price, amount: proceeds, pnl,
              strategy: 'stop_loss',
              reason: `SERVER BOT: Stop loss at ${(pctChange * 100).toFixed(1)}%`,
            })
            await supabase.from('bot_logs').insert({
              user_id: user.user_id,
              message: `SERVER BOT: STOP LOSS ${sym} at ${(pctChange * 100).toFixed(1)}% | P&L: $${pnl.toFixed(2)}`,
              log_type: 'trade',
            })
            results.push({ user: user.user_id, action: 'STOP_LOSS', asset: sym, pnl })

          } else if (pctChange >= (riskConfig.takeProfitPct / 100)) {
            // TAKE PROFIT — sell entire position
            const qty = Number(pos.quantity)
            const proceeds = qty * price
            const pnl = proceeds - qty * avgPrice
            const sym = ASSET_MAP[pos.asset_id] || pos.symbol || pos.asset_id.toUpperCase()

            await supabase.from('positions').delete().eq('id', pos.id)
            await supabase.from('paper_accounts').update({ cash: cash + proceeds }).eq('id', account.id)
            cash += proceeds

            await supabase.from('trades').insert({
              user_id: user.user_id, account_id: account.id,
              asset_id: pos.asset_id, symbol: sym, side: 'SELL',
              quantity: qty, price, amount: proceeds, pnl,
              strategy: 'take_profit',
              reason: `SERVER BOT: Take profit at +${(pctChange * 100).toFixed(1)}%`,
            })
            await supabase.from('bot_logs').insert({
              user_id: user.user_id,
              message: `SERVER BOT: TAKE PROFIT ${sym} at +${(pctChange * 100).toFixed(1)}% | P&L: +$${pnl.toFixed(2)}`,
              log_type: 'trade',
            })
            results.push({ user: user.user_id, action: 'TAKE_PROFIT', asset: sym, pnl })
          }
        }

        // 7. Reload positions after stop-loss/take-profit
        const { data: currentPositions } = await supabase
          .from('positions')
          .select('*')
          .eq('user_id', user.user_id)
          .eq('account_id', account.id)

        // Check if we can open new positions
        if ((currentPositions?.length || 0) >= riskConfig.maxPositions) continue

        // 8. Analyze each asset for buy signals
        const assets = Object.keys(ASSET_MAP)

        for (const assetId of assets) {
          // Skip if already holding this asset
          if (currentPositions?.find(p => p.asset_id === assetId)) continue

          const priceData = prices[assetId]
          if (!priceData?.usd) continue

          // Load historical closes from asset_daily_stats
          const { data: history } = await supabase
            .from('asset_daily_stats')
            .select('close_price')
            .eq('asset_id', assetId)
            .order('date', { ascending: true })
            .limit(200)

          if (!history || history.length < 20) continue

          const closes = history.map(h => Number(h.close_price))
          closes.push(priceData.usd) // append current price

          const signals = analyzeAsset(closes, priceData.usd, priceData.usd_24h_change || 0)
          const buySignals = signals.filter(s => s.dir === 'buy')

          // Hybrid logic: trade if 2+ strategies agree or single signal >= 75% confidence
          const hasMultiple = buySignals.length >= 2
          const hasHighConf = buySignals.some(s => s.conf >= 75)

          if (hasMultiple || hasHighConf) {
            const bestSignal = buySignals.sort((a, b) => b.conf - a.conf)[0]
            const positionSize = riskConfig.positionSizePct / 100
            const buyAmount = Math.min(cash * positionSize, cash)

            if (buyAmount < 10) continue // minimum trade size

            const sym = ASSET_MAP[assetId] || assetId.toUpperCase()
            const qty = buyAmount / priceData.usd
            const fees = buyAmount * 0.006 // 0.6% fee estimate

            // Execute buy
            await supabase.from('positions').insert({
              user_id: user.user_id, account_id: account.id,
              asset_id: assetId, symbol: sym,
              quantity: qty, avg_price: priceData.usd,
            })

            await supabase.from('paper_accounts')
              .update({ cash: cash - buyAmount })
              .eq('id', account.id)
            cash -= buyAmount

            const reason = `SERVER BOT: ${bestSignal.reason} [${hasMultiple ? 'Multiple strategies agree' : 'High confidence ' + bestSignal.conf + '%'}]`

            await supabase.from('trades').insert({
              user_id: user.user_id, account_id: account.id,
              asset_id: assetId, symbol: sym,
              side: 'BUY', quantity: qty, price: priceData.usd,
              amount: buyAmount, fees,
              strategy: bestSignal.strat, reason,
            })

            await supabase.from('bot_logs').insert({
              user_id: user.user_id,
              message: `SERVER BOT: BUY ${sym} $${buyAmount.toFixed(2)} @ $${priceData.usd.toFixed(2)} — ${bestSignal.reason}`,
              log_type: 'trade',
            })

            results.push({ user: user.user_id, action: 'BUY', asset: assetId, sym, amount: buyAmount, reason })
            break // one trade per tick per user
          }
        }

        // Log heartbeat if no action taken for this user
        if (!results.find(r => r.user === user.user_id)) {
          await supabase.from('bot_logs').insert({
            user_id: user.user_id,
            message: `SERVER BOT: Heartbeat — analyzed ${assets.length} assets, no signals met threshold`,
            log_type: 'info',
          })
        }

      } catch (userError) {
        console.error(`Error processing user ${user.user_id}:`, userError)
        results.push({ user: user.user_id, action: 'ERROR', error: (userError as Error).message })
      }
    }

    // 9. Update price cache with latest prices
    for (const [assetId, data] of Object.entries(prices)) {
      try {
        await supabase.from('price_cache').upsert({
          asset_id: assetId, timeframe: 'live',
          data: { usd: (data as any).usd, usd_24h_change: (data as any).usd_24h_change },
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'asset_id,timeframe' })
      } catch (_e) { /* non-critical */ }
    }

    const elapsed = Date.now() - startTime
    return new Response(
      JSON.stringify({
        success: true,
        users_processed: users.length,
        results,
        elapsed_ms: elapsed,
        timestamp: new Date().toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Server bot error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
