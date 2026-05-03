// Canonical metric emitters for AgentMinds reports.
//
// Mirror of the server-side registry at master-agent-system/sync/
// metric_registry.py and the Python SDK at sdks/python/agentminds/
// metrics.py. Sites pushing reports through the Node SDK should use
// these helpers — the canonical names go through to the cross-site
// benchmark surface automatically and your push gets back
// `_meta.metric_registry.status: "all_canonical"`.
//
// Usage
// -----
//
//   const { metrics } = require('@agentmindsdev/node');
//
//   const seoData = metrics.seo({
//     landing_status_code: 200,
//     sitemap_url_count: 42,
//     meta_description_length: 158,
//     h1_count: 1,
//     core_web_vitals_pass: 1,
//   });
//
//   await fetch('https://api.agentminds.dev/api/v1/sync/report', {
//     method: 'POST',
//     headers: { 'X-AgentMinds-Key': YOUR_KEY, 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       site_id: 'your_site',
//       agent: 'seo',
//       schema_url: 'https://agentminds.dev/arp/1.1.0',
//       report: {
//         severity: 'info',
//         summary: 'Daily SEO check',
//         metrics: seoData,
//         // ...
//       },
//     }),
//   });
//
// Naming convention: lowercase ASCII, snake_case, single unit suffix
// per metric (`_ms`, `_pct`, `_count`, `_bytes`, `_per_second`,
// `_ratio`). Boolean signals as `<base>_present` with 0/1 numeric.
//
// Strict signature: each emitter destructures only the canonical
// fields. Unknown fields are silently dropped (vs Python's TypeError),
// because JS object destructuring permissive — caller can still
// inspect the returned object to check what landed.
//
// To propose new canonical metrics, open a PR against
// master-agent-system/sync/metric_registry.py + this file + the
// Python SDK module.

'use strict';

function dropUndefined(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined && obj[k] !== null) {
      out[k] = obj[k];
    }
  }
  return out;
}

// ─── Web hygiene / public-surface agents ─────────────────────────

function seo({
  landing_status_code,
  sitemap_url_count,
  robots_txt_present,
  meta_description_length,
  core_web_vitals_pass,
  h1_count,
  json_ld_blocks_count,
} = {}) {
  return dropUndefined({
    landing_status_code,
    sitemap_url_count,
    robots_txt_present,
    meta_description_length,
    core_web_vitals_pass,
    h1_count,
    json_ld_blocks_count,
  });
}

function liveSeo({
  landing_status_code,
  sitemap_url_count,
  robots_txt_present,
  meta_description_length,
} = {}) {
  return dropUndefined({
    landing_status_code,
    sitemap_url_count,
    robots_txt_present,
    meta_description_length,
  });
}

function security({
  hsts_present,
  csp_present,
  x_frame_options_present,
  x_content_type_options_present,
  referrer_policy_present,
  permissions_policy_present,
  ssl_days_remaining,
  mixed_content_count,
  cors_origins_count,
} = {}) {
  return dropUndefined({
    hsts_present,
    csp_present,
    x_frame_options_present,
    x_content_type_options_present,
    referrer_policy_present,
    permissions_policy_present,
    ssl_days_remaining,
    mixed_content_count,
    cors_origins_count,
  });
}

function liveSecurity({
  hsts_present,
  csp_present,
  x_frame_options_present,
} = {}) {
  return dropUndefined({
    hsts_present,
    csp_present,
    x_frame_options_present,
  });
}

// ─── Runtime / health agents ─────────────────────────────────────

function performance({
  response_time_ms_p50,
  response_time_ms_p95,
  response_time_ms_p99,
  throughput_rps,
  error_rate_pct,
  memory_usage_mb,
  cpu_usage_pct,
} = {}) {
  return dropUndefined({
    response_time_ms_p50,
    response_time_ms_p95,
    response_time_ms_p99,
    throughput_rps,
    error_rate_pct,
    memory_usage_mb,
    cpu_usage_pct,
  });
}

function health({
  uptime_pct,
  last_pipeline_status,
  open_circuits_count,
  alerts_1h_count,
} = {}) {
  return dropUndefined({
    uptime_pct,
    last_pipeline_status,
    open_circuits_count,
    alerts_1h_count,
  });
}

function uptime({
  web_response_time_ms,
  api_response_time_ms,
  ssl_days_remaining,
} = {}) {
  return dropUndefined({
    web_response_time_ms,
    api_response_time_ms,
    ssl_days_remaining,
  });
}

function error({
  errors_1h_count,
  errors_24h_count,
  deploy_failures_recent_count,
} = {}) {
  return dropUndefined({
    errors_1h_count,
    errors_24h_count,
    deploy_failures_recent_count,
  });
}

// ─── DB / infra agents ───────────────────────────────────────────

function database({
  connection_pool_utilization_pct,
  query_time_ms_p95,
  slow_query_count,
  replication_lag_seconds,
} = {}) {
  return dropUndefined({
    connection_pool_utilization_pct,
    query_time_ms_p95,
    slow_query_count,
    replication_lag_seconds,
  });
}

function infra({
  deploy_count_24h,
  deploy_duration_seconds,
  container_restarts_24h,
} = {}) {
  return dropUndefined({
    deploy_count_24h,
    deploy_duration_seconds,
    container_restarts_24h,
  });
}

// ─── Content / SEO+ agents ───────────────────────────────────────

function content({
  blog_post_count,
  newest_post_age_days,
  stale_posts_90d_count,
} = {}) {
  return dropUndefined({
    blog_post_count,
    newest_post_age_days,
    stale_posts_90d_count,
  });
}

// ─── Behavioral / business agents ────────────────────────────────

function userBehavior({
  user_count_total,
  user_count_active,
  dau_mau_ratio_pct,
  churn_rate_pct,
} = {}) {
  return dropUndefined({
    user_count_total,
    user_count_active,
    dau_mau_ratio_pct,
    churn_rate_pct,
  });
}

function feedback({
  feedback_count_total,
  irrelevant_tip_count,
  site_type_corrections_count,
} = {}) {
  return dropUndefined({
    feedback_count_total,
    irrelevant_tip_count,
    site_type_corrections_count,
  });
}

function growth({
  registered_sites_count,
  active_sites_count,
  patterns_observed_count,
  actionable_patterns_count,
} = {}) {
  return dropUndefined({
    registered_sites_count,
    active_sites_count,
    patterns_observed_count,
    actionable_patterns_count,
  });
}

// ─── Pipeline / orchestration ────────────────────────────────────

function pipeline({
  last_run_status,
  last_run_duration_seconds,
  last_run_age_hours,
  alerts_count,
} = {}) {
  return dropUndefined({
    last_run_status,
    last_run_duration_seconds,
    last_run_age_hours,
    alerts_count,
  });
}

function freshness({
  pool_age_hours,
  stale_agents_count,
  stale_sites_count,
} = {}) {
  return dropUndefined({
    pool_age_hours,
    stale_agents_count,
    stale_sites_count,
  });
}

// ─── Discovery helpers ───────────────────────────────────────────

function supportedAgents() {
  return [
    'content', 'database', 'error', 'feedback', 'freshness', 'growth',
    'health', 'infra', 'live_security', 'live_seo', 'performance',
    'pipeline', 'security', 'seo', 'uptime', 'user_behavior',
  ].sort();
}

module.exports = {
  seo,
  liveSeo,
  security,
  liveSecurity,
  performance,
  health,
  uptime,
  error,
  database,
  infra,
  content,
  userBehavior,
  feedback,
  growth,
  pipeline,
  freshness,
  supportedAgents,
};
