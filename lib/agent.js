// Runs a TinyFish Agent goal with Errand's failure handling:
// - streams progress + the live browser URL into the job log
// - detects "COMPLETED but actually blocked/captcha" results
// - stops when a retailer presents a CAPTCHA, login wall, or access-denied page
import { runAgent, AGENT_PROXY_COUNTRIES } from './tinyfish.js';
import { detectBlock, explainFailure } from './safety.js';

export async function smartRun(ctx, { url, goal, schema, country, label, maxSeconds = 240, stealthFirst = false, noRetry = false, profileId = null, extra = {} }) {
  // Access-denied and CAPTCHA pages are terminal by READ_ONLY_RULES. Do not
  // automatically retry them with a different browser mode.
  const attempts = stealthFirst ? ['stealth'] : ['lite'];
  let last;
  for (const mode of attempts) {
    const body = {
      url,
      goal,
      browser_profile: mode,
      agent_config: { max_duration_seconds: maxSeconds },
      ...extra,
    };
    if (schema) body.output_schema = schema;
    if (profileId) {
      body.use_profile = true;
      body.profile_id = profileId;
    }
    if (mode === 'stealth') {
      // Do not silently send India searches through a US proxy when the run
      // API does not support that exit country. Saved IN profiles are applied above.
      if (AGENT_PROXY_COUNTRIES.includes(country)) body.proxy_config = { enabled: true, country_code: country };
    }
    ctx.log(`${label}: agent started${mode === 'stealth' ? ' (stealth mode)' : ''}`, { tag: label });
    let run;
    try {
      run = await runAgent(body, {
        // The provider slot may be queued behind other searches. Start this
        // deadline only once the remote run can actually begin.
        timeoutMs: (maxSeconds + 20) * 1000,
        onEvent: (ev) => {
          if (ev.type === 'STREAMING_URL') ctx.log(`${label}: live view ready`, { tag: label, live: ev.streaming_url });
          if (ev.type === 'PROGRESS') ctx.log(`${label}: ${ev.purpose}`, { tag: label });
        },
      });
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError' || err.code === 23;
      run = { status: 'FAILED', error: { code: isTimeout ? 'TIMEOUT' : (err.code || 'AGENT_ERROR'), message: isTimeout ? `Timed out after ${maxSeconds}s` : err.message } };
    }
    ctx.log(`${label}: agent finished (${run.steps ?? '?'} steps)`, { tag: label, liveEnd: true });
    ctx.usage('agentRuns');
    if (run.steps) ctx.usage('agentSteps', run.steps);
    last = run;

    if (run.error?.code === 'TIMEOUT') break;

    const block = run.status === 'COMPLETED' ? detectBlock(run) : (run.error?.code === 'SITE_BLOCKED' ? 'blocked' : null);
    if (run.status === 'COMPLETED' && !block) return { ok: true, ...run, mode };
    if (!block) break; // non-block failure: retrying the same goal rarely helps
  }
  const reason = detectBlock(last) ? 'This site blocks automated browsers (CAPTCHA / bot wall). Check it yourself.' : explainFailure(last);
  ctx.log(`${label}: ${reason}`, { tag: label, level: 'error' });
  return { ok: false, reason, ...last };
}
