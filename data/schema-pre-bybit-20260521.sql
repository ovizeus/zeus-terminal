CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    approved    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  , banned_until TEXT DEFAULT NULL, telegram_bot_token_enc TEXT DEFAULT NULL, telegram_chat_id TEXT DEFAULT NULL, pin_hash TEXT DEFAULT NULL, token_version INTEGER NOT NULL DEFAULT 1, pwd_temp_expires_at TEXT DEFAULT NULL, pwd_must_change INTEGER NOT NULL DEFAULT 0, last_active_at INTEGER DEFAULT NULL, telegram_broken_at INTEGER DEFAULT NULL, telegram_broken_reason TEXT DEFAULT NULL, terms_accepted_at TEXT DEFAULT NULL, terms_version TEXT DEFAULT NULL);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE exchange_accounts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    exchange            TEXT NOT NULL DEFAULT 'binance',
    api_key_encrypted   TEXT NOT NULL,
    api_secret_encrypted TEXT NOT NULL,
    mode                TEXT NOT NULL DEFAULT 'live',
    status              TEXT NOT NULL DEFAULT 'verified',
    last_verified_at    TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    details    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE INDEX idx_exchange_user ON exchange_accounts(user_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);
CREATE TABLE at_positions (
    seq         INTEGER PRIMARY KEY,
    data        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'OPEN',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  , user_id INTEGER DEFAULT NULL);
CREATE INDEX idx_at_pos_status ON at_positions(status);
CREATE INDEX idx_at_pos_user ON at_positions(user_id);
CREATE TABLE _migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE password_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            password_hash TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
CREATE INDEX idx_pw_history_user ON password_history(user_id);
CREATE TABLE trade_annotations (
            seq         INTEGER NOT NULL,
            user_id     INTEGER NOT NULL,
            notes       TEXT DEFAULT '',
            tags        TEXT DEFAULT '[]',
            rating      INTEGER DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (seq, user_id)
        );
CREATE INDEX idx_annotations_user ON trade_annotations(user_id);
CREATE TABLE missed_trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            symbol      TEXT NOT NULL,
            side        TEXT NOT NULL,
            reason      TEXT NOT NULL,
            price       REAL NOT NULL,
            confidence  INTEGER DEFAULT 0,
            tier        TEXT,
            regime      TEXT,
            data        TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE INDEX idx_missed_user ON missed_trades(user_id);
CREATE INDEX idx_missed_time ON missed_trades(created_at);
CREATE TABLE regime_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            regime      TEXT NOT NULL,
            prev_regime TEXT,
            confidence  INTEGER DEFAULT 0,
            price       REAL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        , user_id INTEGER DEFAULT NULL);
CREATE INDEX idx_regime_symbol ON regime_history(symbol);
CREATE INDEX idx_regime_time ON regime_history(created_at);
CREATE TABLE brain_decisions (
            snap_id     TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL,
            symbol      TEXT NOT NULL,
            ts          INTEGER NOT NULL,
            cycle       INTEGER NOT NULL,
            source_path TEXT NOT NULL,
            final_tier  TEXT NOT NULL,
            final_conf  INTEGER NOT NULL,
            final_dir   TEXT NOT NULL,
            final_action TEXT NOT NULL,
            linked_seq  INTEGER DEFAULT NULL,
            data        TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE INDEX idx_bd_user_ts ON brain_decisions(user_id, ts);
CREATE INDEX idx_bd_symbol_ts ON brain_decisions(symbol, ts);
CREATE INDEX idx_bd_linked ON brain_decisions(linked_seq);
CREATE INDEX idx_bd_action ON brain_decisions(final_action, ts);
CREATE TABLE user_settings (
            user_id     INTEGER PRIMARY KEY,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE TABLE ares_state (
            user_id     INTEGER PRIMARY KEY,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE TABLE user_ctx_data (
            user_id     INTEGER NOT NULL,
            section     TEXT NOT NULL,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, section)
        );
CREATE TABLE IF NOT EXISTS "at_state" (
            key     TEXT    PRIMARY KEY,
            value   TEXT    NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
CREATE INDEX idx_at_state_user ON at_state(user_id);
CREATE INDEX idx_regime_user ON regime_history(user_id);
CREATE UNIQUE INDEX idx_exchange_user_active_single ON exchange_accounts(user_id) WHERE is_active = 1;
CREATE TABLE login_attempts (
            key      TEXT NOT NULL,
            kind     TEXT NOT NULL,
            count    INTEGER NOT NULL DEFAULT 0,
            reset_at INTEGER NOT NULL,
            PRIMARY KEY (kind, key)
        );
CREATE INDEX idx_login_attempts_reset ON login_attempts(reset_at);
CREATE TABLE brain_parity_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            symbol       TEXT NOT NULL,
            source       TEXT NOT NULL CHECK(source IN ('client','server')),
            cycle        INTEGER,
            dir          TEXT,
            decision     TEXT,
            confidence   REAL,
            score        REAL,
            reasons      TEXT,
            created_at   INTEGER NOT NULL
        );
CREATE INDEX idx_parity_user_symbol_ts ON brain_parity_log(user_id, symbol, created_at);
CREATE INDEX idx_parity_source_ts      ON brain_parity_log(source, created_at);
CREATE INDEX idx_at_pos_user_status ON at_positions(user_id, status);
CREATE UNIQUE INDEX idx_at_pos_user_sym_side_mode_open
        ON at_positions(
            user_id,
            json_extract(data, '$.symbol'),
            json_extract(data, '$.side'),
            json_extract(data, '$.mode')
        )
        WHERE status='OPEN';
CREATE TABLE dsl_parity_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            pos_id       TEXT NOT NULL,
            symbol       TEXT NOT NULL,
            source       TEXT NOT NULL CHECK(source IN ('client','server')),
            phase        TEXT,
            current_sl   REAL,
            pivot_left   REAL,
            pivot_right  REAL,
            impulse_val  REAL,
            entry_price  REAL,
            tick_price   REAL,
            created_at   INTEGER NOT NULL
        );
CREATE INDEX idx_dsl_parity_user_pos_ts ON dsl_parity_log(user_id, pos_id, created_at);
CREATE INDEX idx_dsl_parity_source_ts   ON dsl_parity_log(source, created_at);
CREATE TABLE IF NOT EXISTS "at_closed" (
            seq         INTEGER PRIMARY KEY,
            data        TEXT NOT NULL,
            closed_at   TEXT NOT NULL DEFAULT (datetime('now')),
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
        );
CREATE INDEX idx_at_closed_user ON at_closed(user_id);
CREATE INDEX idx_at_closed_user_closed_at ON at_closed(user_id, closed_at DESC);
CREATE TABLE ml_runtime_features (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol            TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            effective_weight  REAL NOT NULL DEFAULT 0.0,
            sample_count      INTEGER NOT NULL DEFAULT 0,
            success_count     INTEGER NOT NULL DEFAULT 0,
            status            TEXT NOT NULL DEFAULT 'ACTIVE'
                              CHECK(status IN ('ACTIVE','QUARANTINED','RETIRED','SHADOW','PROPOSED')),
            evidence_json     TEXT,
            last_updated_at   INTEGER NOT NULL,
            created_at        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, symbol, feature_id)
        );
CREATE INDEX idx_mlrf_user_env_sym
            ON ml_runtime_features(user_id, resolved_env, symbol);
CREATE INDEX idx_mlrf_status_env
            ON ml_runtime_features(status, resolved_env);
CREATE TABLE ml_feature_audit_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol          TEXT NOT NULL,
            feature_id      TEXT NOT NULL,
            event_type      TEXT NOT NULL CHECK(event_type IN (
                'PROPOSED','PROMOTED','DEMOTED','QUARANTINED','UNQUARANTINED',
                'RETIRED','WEIGHT_UPDATED','SAMPLE_INCREMENTED'
            )),
            old_value_json  TEXT,
            new_value_json  TEXT,
            actor           TEXT NOT NULL,
            reason          TEXT,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlfal_feature_ts
            ON ml_feature_audit_log(user_id, resolved_env, symbol, feature_id, created_at);
CREATE INDEX idx_mlfal_event_ts
            ON ml_feature_audit_log(event_type, created_at);
CREATE TABLE ml_feature_proposals (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol            TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            proposed_weight   REAL NOT NULL,
            current_weight    REAL,
            delta_class       TEXT NOT NULL CHECK(delta_class IN ('MINOR','MAJOR','CRITICAL')),
            evidence_json     TEXT,
            state             TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK(state IN ('PENDING','APPLIED','REJECTED','EXPIRED')),
            decided_at        INTEGER,
            decided_by        TEXT,
            created_at        INTEGER NOT NULL
        );
CREATE INDEX idx_mlfp_state_created
            ON ml_feature_proposals(state, created_at);
CREATE INDEX idx_mlfp_user_env_pending
            ON ml_feature_proposals(user_id, resolved_env, state) WHERE state = 'PENDING';
CREATE TABLE ml_feature_global_overrides (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            scope             TEXT NOT NULL CHECK(scope IN (
                'CHARTER','GLOBAL','RESOLVED_ENV','SYMBOL','ENV_SYMBOL'
            )),
            scope_key         TEXT NOT NULL,
            feature_id        TEXT NOT NULL,
            override_status   TEXT NOT NULL CHECK(override_status IN (
                'QUARANTINED','RETIRED','BLOCKED','FORCED_ACTIVE'
            )),
            reason            TEXT NOT NULL,
            created_by        TEXT NOT NULL,
            created_at        INTEGER NOT NULL,
            expires_at        INTEGER,
            UNIQUE(scope, scope_key, feature_id)
        );
CREATE INDEX idx_mlfgo_resolver
            ON ml_feature_global_overrides(scope, feature_id);
CREATE TABLE ml_decision_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                   TEXT NOT NULL,
            snapshot_event_type      TEXT NOT NULL CHECK(snapshot_event_type IN (
                'TRADE','ABSTAIN_CRITIC','NEAR_THRESHOLD','OPERATOR_OVERRIDE',
                'QUARANTINE_TRIGGER','PROMOTION_TRIGGER','ANOMALY_DRIFT'
            )),
            decision_digest          TEXT NOT NULL,
            snapshot_json            TEXT NOT NULL,
            registry_digest          TEXT NOT NULL,
            input_snapshot_ref       TEXT,
            created_at               INTEGER NOT NULL
        );
CREATE INDEX idx_mlds_user_env_ts
            ON ml_decision_snapshots(user_id, resolved_env, created_at);
CREATE INDEX idx_mlds_digest
            ON ml_decision_snapshots(decision_digest);
CREATE INDEX idx_mlds_event_ts
            ON ml_decision_snapshots(snapshot_event_type, created_at);
CREATE TABLE ml_decision_light (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            decision_digest     TEXT NOT NULL,
            score               REAL,
            top5_features_json  TEXT,
            abstain_count       INTEGER NOT NULL DEFAULT 0,
            reason_code         TEXT,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mldl_user_env_ts
            ON ml_decision_light(user_id, resolved_env, created_at);
CREATE TABLE ml_attribution_events (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_digest      TEXT NOT NULL,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol               TEXT NOT NULL,
            pos_id               TEXT,
            outcome_class        TEXT NOT NULL CHECK(outcome_class IN (
                'WIN','LOSS','BREAKEVEN','TIMEOUT','MANUAL_CLOSE','ABSTAIN_CORRECT','ABSTAIN_WRONG'
            )),
            r_multiple           REAL,
            pnl_pct              REAL,
            operator_feedback    INTEGER,
            attributed_at        INTEGER NOT NULL
        , causal_class TEXT, assessment_json TEXT, regime TEXT, session TEXT, score_at_entry REAL, mfe_pct REAL, mae_pct REAL, slippage_pct REAL, time_in_trade_min REAL, side TEXT);
CREATE INDEX idx_mlae_digest
            ON ml_attribution_events(decision_digest);
CREATE INDEX idx_mlae_user_env_ts
            ON ml_attribution_events(user_id, resolved_env, attributed_at);
CREATE TABLE ml_voice_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            utterance_type    TEXT NOT NULL CHECK(utterance_type IN (
                'THOUGHT','CHAT_REPLY','GREETING','FAREWELL','CRITICAL_ALERT','REACTION'
            )),
            mood              TEXT NOT NULL CHECK(mood IN (
                'CALM','FOCUSED','EXCITED','NERVOUS','ANGRY','SAD','BORED'
            )),
            text              TEXT NOT NULL,
            template_id       TEXT,
            context_json      TEXT,
            decision_digest   TEXT,
            created_at        INTEGER NOT NULL
        , extraction_status TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at INTEGER, next_retry_at INTEGER);
CREATE INDEX idx_mlvl_user_ts
            ON ml_voice_log(user_id, created_at);
CREATE INDEX idx_mlvl_type_mood
            ON ml_voice_log(utterance_type, mood);
CREATE TABLE ml_operator_approval (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            request_type             TEXT NOT NULL CHECK(request_type IN (
                'PROMOTION','DEMOTION','QUARANTINE','RESUME','CHARTER_CHANGE',
                'OVERRIDE_ADD','OVERRIDE_REMOVE','EMERGENCY_HALT','RESUME_FROM_HALT'
            )),
            request_payload_json     TEXT NOT NULL,
            tier                     TEXT NOT NULL CHECK(tier IN ('MINOR','MAJOR','CRITICAL')),
            queue_state              TEXT NOT NULL DEFAULT 'PENDING'
                                     CHECK(queue_state IN ('PENDING','APPROVED','REJECTED','EXPIRED','APPLIED')),
            cooldown_until           INTEGER,
            requested_at             INTEGER NOT NULL,
            decided_at               INTEGER,
            decided_by               TEXT,
            decision                 TEXT,
            signature                TEXT
        );
CREATE INDEX idx_mloa_user_state
            ON ml_operator_approval(user_id, queue_state);
CREATE INDEX idx_mloa_tier_state
            ON ml_operator_approval(tier, queue_state);
CREATE TABLE ml_ring_health (
            ring_id           TEXT PRIMARY KEY CHECK(ring_id IN (
                'R-1','R0','R1','R2','R3A','R3B','R4','R5A','R5B','R6','R7'
            )),
            state             TEXT NOT NULL CHECK(state IN (
                'OK','DEGRADED','OFFLINE','DISABLED','INITIALIZING'
            )),
            last_heartbeat    INTEGER NOT NULL,
            error_count_1h    INTEGER NOT NULL DEFAULT 0,
            last_error_text   TEXT,
            last_error_at     INTEGER,
            updated_at        INTEGER NOT NULL
        );
CREATE INDEX idx_mlae_regime_ts
            ON ml_attribution_events(regime, attributed_at);
CREATE INDEX idx_mlae_session_ts
            ON ml_attribution_events(session, attributed_at);
CREATE TABLE ml_governance_versions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            component_type      TEXT NOT NULL CHECK(component_type IN (
                'model', 'detector', 'feature_schema', 'risk_config', 'execution_config'
            )),
            component_id        TEXT NOT NULL,
            version             TEXT NOT NULL,
            config_json         TEXT NOT NULL,
            config_hash         TEXT NOT NULL,
            parent_version_id   INTEGER,
            motivation          TEXT NOT NULL,
            actor               TEXT NOT NULL,
            kpi_delta_json      TEXT,
            state               TEXT NOT NULL DEFAULT 'PROPOSED'
                                CHECK(state IN ('PROPOSED', 'ACTIVE', 'ROLLED_BACK', 'RETIRED')),
            activated_at        INTEGER,
            rolled_back_at      INTEGER,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlgv_component_state
            ON ml_governance_versions(component_type, component_id, state);
CREATE INDEX idx_mlgv_created_at
            ON ml_governance_versions(created_at);
CREATE TABLE ml_hypothesis_pre_registrations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id               INTEGER NOT NULL,
            hypothesis               TEXT NOT NULL,
            predicted_metrics_json   TEXT NOT NULL,
            success_criteria_json    TEXT NOT NULL,
            eval_window_from         INTEGER NOT NULL,
            eval_window_to           INTEGER NOT NULL,
            registration_hash        TEXT NOT NULL,
            state                    TEXT NOT NULL DEFAULT 'REGISTERED'
                                     CHECK(state IN ('REGISTERED', 'EVALUATING', 'PASS', 'FAIL', 'INVALID')),
            actual_metrics_json      TEXT,
            pass_fail_details_json   TEXT,
            actor                    TEXT NOT NULL,
            registered_at            INTEGER NOT NULL,
            evaluated_at             INTEGER
        );
CREATE INDEX idx_mlhpr_version_state
            ON ml_hypothesis_pre_registrations(version_id, state);
CREATE TABLE ml_dd_pauses (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pause_reason             TEXT NOT NULL,
            dd_at_pause              REAL NOT NULL,
            state                    TEXT NOT NULL DEFAULT 'ACTIVE'
                                     CHECK(state IN ('ACTIVE', 'RESUMED', 'EXPIRED')),
            resume_eligible_after    INTEGER NOT NULL,
            shadow_wins_count        INTEGER NOT NULL DEFAULT 0,
            auto_resumed             INTEGER NOT NULL DEFAULT 0,
            paused_at                INTEGER NOT NULL,
            resumed_at               INTEGER,
            resumed_by               TEXT,
            resume_reason            TEXT,
            paused_by                TEXT NOT NULL
        , recovery_stage INTEGER NOT NULL DEFAULT 0, recovery_wins_at_stage INTEGER NOT NULL DEFAULT 0, recovery_started_at INTEGER);
CREATE INDEX idx_mldp_user_env_state
            ON ml_dd_pauses(user_id, resolved_env, state);
CREATE TABLE ml_operator_escalations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            approval_id              INTEGER NOT NULL,
            level                    TEXT NOT NULL CHECK(level IN (
                'WARN', 'HANDOVER', 'FALLBACK'
            )),
            hours_since_request      REAL NOT NULL,
            action_taken             TEXT NOT NULL,
            actor                    TEXT NOT NULL,
            notified_operators_json  TEXT,
            created_at               INTEGER NOT NULL,
            UNIQUE(approval_id, level)
        );
CREATE INDEX idx_mloe_approval_ts
            ON ml_operator_escalations(approval_id, created_at);
CREATE TABLE ml_black_swan_events (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            severity            TEXT NOT NULL CHECK(severity IN ('MINOR','MAJOR','CRITICAL')),
            signals_json        TEXT NOT NULL,
            triggers_json       TEXT NOT NULL,
            abstention_state    TEXT NOT NULL DEFAULT 'ACTIVE'
                                CHECK(abstention_state IN ('ACTIVE','CLEARED','EXPIRED')),
            cooldown_until      INTEGER NOT NULL,
            actor               TEXT NOT NULL,
            detected_at         INTEGER NOT NULL,
            cleared_at          INTEGER,
            cleared_by          TEXT,
            clear_reason        TEXT
        );
CREATE INDEX idx_mlbs_user_env_state
            ON ml_black_swan_events(user_id, resolved_env, abstention_state);
CREATE TABLE ml_dr_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type     TEXT NOT NULL CHECK(record_type IN (
                'HEARTBEAT', 'BACKUP', 'FAILOVER', 'DRILL'
            )),
            node_id         TEXT,
            role            TEXT,
            state           TEXT,
            payload_json    TEXT NOT NULL,
            actor           TEXT,
            created_at      INTEGER NOT NULL,
            expires_at      INTEGER
        );
CREATE INDEX idx_mldr_type_ts
            ON ml_dr_state(record_type, created_at);
CREATE INDEX idx_mldr_node_type
            ON ml_dr_state(node_id, record_type, created_at);
CREATE TABLE ml_shadow_stage_log (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id              INTEGER NOT NULL,
            stage                   TEXT NOT NULL CHECK(stage IN (
                'offline_backtest', 'walk_forward', 'paper',
                'shadow_live', 'limited_probation', 'normal_live'
            )),
            transition_type         TEXT NOT NULL CHECK(transition_type IN (
                'ENTER', 'EXIT', 'DEGRADE', 'PAUSE', 'ROLLBACK'
            )),
            metrics_json            TEXT,
            threshold_breach_json   TEXT,
            reason                  TEXT NOT NULL,
            actor                   TEXT NOT NULL,
            started_at              INTEGER NOT NULL,
            ended_at                INTEGER
        );
CREATE INDEX idx_mlssl_version_ts
            ON ml_shadow_stage_log(version_id, started_at);
CREATE TABLE ml_experiments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL,
            version_a_id        INTEGER NOT NULL,
            version_b_id        INTEGER NOT NULL,
            allocation_pct_b    REAL NOT NULL CHECK(allocation_pct_b >= 0 AND allocation_pct_b <= 100),
            isolation_mode      TEXT NOT NULL CHECK(isolation_mode IN ('STRICT','SHARED_CAPITAL')),
            state               TEXT NOT NULL DEFAULT 'CREATED'
                                CHECK(state IN ('CREATED','RUNNING','COMPLETED','PROMOTED','ROLLED_BACK')),
            started_at          INTEGER,
            completed_at        INTEGER,
            decided_at          INTEGER,
            decided_by          TEXT,
            decision_reason     TEXT,
            actor               TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlexp_state
            ON ml_experiments(state, created_at);
CREATE TABLE ml_experiment_outcomes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            experiment_id       INTEGER NOT NULL,
            arm                 TEXT NOT NULL CHECK(arm IN ('A','B')),
            decision_digest     TEXT NOT NULL,
            outcome             TEXT NOT NULL,
            pnl_pct             REAL,
            recorded_at         INTEGER NOT NULL
        );
CREATE INDEX idx_mlexpo_exp_arm
            ON ml_experiment_outcomes(experiment_id, arm);
CREATE TABLE ml_human_overrides (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            record_type     TEXT NOT NULL CHECK(record_type IN (
                'OVERRIDE', 'KILL_SWITCH', 'REVIEW_REQUEST'
            )),
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            override_kind   TEXT,
            state           TEXT NOT NULL DEFAULT 'ACTIVE'
                            CHECK(state IN ('ACTIVE', 'CLEARED', 'APPROVED', 'REJECTED')),
            payload_json    TEXT,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            cleared_at      INTEGER
        );
CREATE INDEX idx_mlho_user_env_type_state
            ON ml_human_overrides(user_id, resolved_env, record_type, state);
CREATE TABLE ml_veto_log (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision            TEXT NOT NULL CHECK(decision IN ('BLOCK','PROCEED','PENALIZED')),
            winning_signal      TEXT,
            winning_severity    TEXT CHECK(winning_severity IN ('BLOCK','SCORE_PENALTY') OR winning_severity IS NULL),
            winning_hierarchy   TEXT,
            blockers_json       TEXT NOT NULL,
            penalties_json      TEXT NOT NULL,
            score_input         REAL,
            score_adjusted      REAL,
            context_json        TEXT,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlvl_user_env_ts
            ON ml_veto_log(user_id, resolved_env, created_at);
CREATE INDEX idx_mlvl_decision_ts
            ON ml_veto_log(decision, created_at);
CREATE TABLE ml_freshness_log (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            action                TEXT NOT NULL CHECK(action IN
                                  ('OK','OBSERVER','ALERT','PAUSE','REDUCE_RISK','NO_TRADE')),
            issue_count           INTEGER NOT NULL DEFAULT 0,
            stale_feeds_json      TEXT NOT NULL,
            divergences_json      TEXT NOT NULL,
            snapshot_issues_json  TEXT NOT NULL,
            clock_drift_ms        REAL,
            context_json          TEXT,
            created_at            INTEGER NOT NULL
        );
CREATE INDEX idx_mlfl_user_env_ts
            ON ml_freshness_log(user_id, resolved_env, created_at);
CREATE INDEX idx_mlfl_action_ts
            ON ml_freshness_log(action, created_at);
CREATE TABLE ml_recon_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            check_type        TEXT NOT NULL CHECK(check_type IN ('RECON','LATENCY','RATE_LIMIT')),
            subject           TEXT,
            action            TEXT NOT NULL CHECK(action IN ('OK','ALERT','LOCK','FLATTEN')),
            severity          REAL NOT NULL DEFAULT 0,
            divergences_json  TEXT NOT NULL DEFAULT '[]',
            details_json      TEXT,
            created_at        INTEGER NOT NULL
        );
CREATE INDEX idx_mlrl_user_env_type_ts
            ON ml_recon_log(user_id, resolved_env, check_type, created_at);
CREATE INDEX idx_mlrl_action_ts
            ON ml_recon_log(action, created_at);
CREATE TABLE ml_circuit_state (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            level                         TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4','L5')),
            reason                        TEXT NOT NULL,
            actor                         TEXT NOT NULL,
            probation_active              INTEGER NOT NULL DEFAULT 0,
            probation_trades_remaining    INTEGER NOT NULL DEFAULT 0,
            manual_required               INTEGER NOT NULL DEFAULT 0,
            since                         INTEGER NOT NULL,
            updated_at                    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_circuit_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            old_level       TEXT,
            new_level       TEXT NOT NULL CHECK(new_level IN ('L0','L1','L2','L3','L4','L5')),
            transition_type TEXT NOT NULL CHECK(transition_type IN
                            ('ESCALATE','PROBATION_ENTER','PROBATION_DECREMENT','RESUME')),
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlch_user_env_ts
            ON ml_circuit_history(user_id, resolved_env, created_at);
CREATE TABLE ml_portfolio_state (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            check_kind            TEXT NOT NULL CHECK(check_kind IN
                                  ('POSITION_RISK','EXPOSURE','CLUSTER','RUIN','CORRELATION')),
            decision              TEXT NOT NULL CHECK(decision IN ('ALLOW','RESTRICT','BLOCK')),
            total_exposure_pct    REAL,
            risk_score            REAL,
            details_json          TEXT,
            created_at            INTEGER NOT NULL
        );
CREATE INDEX idx_mlps_user_env_kind_ts
            ON ml_portfolio_state(user_id, resolved_env, check_kind, created_at);
CREATE INDEX idx_mlps_decision_ts
            ON ml_portfolio_state(decision, created_at);
CREATE TABLE ml_confidence_state (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                   TEXT NOT NULL,
            symbol                   TEXT NOT NULL,
            entry_confidence         REAL NOT NULL,
            current_confidence       REAL NOT NULL,
            max_stagnation_ms        INTEGER NOT NULL,
            validation_window_ms     INTEGER NOT NULL,
            thesis_criteria_json     TEXT,
            decay_signals_json       TEXT,
            last_signal_at           INTEGER,
            created_at               INTEGER NOT NULL,
            updated_at               INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, pos_id)
        );
CREATE INDEX idx_mlcs_user_env_pos
            ON ml_confidence_state(user_id, resolved_env, pos_id);
CREATE INDEX idx_mlcs_updated
            ON ml_confidence_state(updated_at);
CREATE TABLE ml_position_state (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id        TEXT NOT NULL,
            symbol        TEXT NOT NULL,
            state         TEXT NOT NULL CHECK(state IN
                          ('IDLE','WATCHING','ARMED','READY','ENTERED','MANAGING',
                           'PARTIAL_TAKEN','RUNNER_ACTIVE','EXITED','INVALIDATED',
                           'LOCKED','COOLDOWN')),
            state_since   INTEGER NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, pos_id)
        );
CREATE TABLE ml_position_transitions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id        TEXT NOT NULL,
            from_state    TEXT NOT NULL CHECK(from_state IN
                          ('IDLE','WATCHING','ARMED','READY','ENTERED','MANAGING',
                           'PARTIAL_TAKEN','RUNNER_ACTIVE','EXITED','INVALIDATED',
                           'LOCKED','COOLDOWN')),
            to_state      TEXT NOT NULL CHECK(to_state IN
                          ('IDLE','WATCHING','ARMED','READY','ENTERED','MANAGING',
                           'PARTIAL_TAKEN','RUNNER_ACTIVE','EXITED','INVALIDATED',
                           'LOCKED','COOLDOWN')),
            event         TEXT,
            reason        TEXT NOT NULL,
            actor         TEXT NOT NULL,
            created_at    INTEGER NOT NULL
        );
CREATE INDEX idx_mlpt_user_env_pos_ts
            ON ml_position_transitions(user_id, resolved_env, pos_id, created_at);
CREATE TABLE ml_detector_registry (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            detector_id           TEXT NOT NULL UNIQUE,
            kind                  TEXT NOT NULL CHECK(kind IN
                                  ('order_flow','liquidity_sweep','regime_classifier',
                                   'derivatives_stress','macro_filter','venue_divergence',
                                   'options_context','portfolio_risk','execution_quality')),
            input_schema_json     TEXT NOT NULL,
            output_schema_json    TEXT NOT NULL,
            time_horizon_ms       INTEGER NOT NULL,
            weight                REAL NOT NULL CHECK(weight >= 0 AND weight <= 1),
            allowed_regimes_json  TEXT NOT NULL,
            model_type            TEXT NOT NULL CHECK(model_type IN
                                  ('LIGHTGBM','XGBOOST','TRANSFORMER','LSTM','HEURISTIC')),
            model_version         TEXT NOT NULL,
            enabled               INTEGER NOT NULL DEFAULT 1,
            created_at            INTEGER NOT NULL,
            updated_at            INTEGER NOT NULL
        );
CREATE TABLE ml_detector_outputs (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            detector_id           TEXT NOT NULL,
            pos_id                TEXT,
            output_json           TEXT NOT NULL,
            regime                TEXT,
            model_version         TEXT,
            created_at            INTEGER NOT NULL
        );
CREATE INDEX idx_mldo_user_env_det_ts
            ON ml_detector_outputs(user_id, resolved_env, detector_id, created_at);
CREATE TABLE ml_explanations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            pos_id              TEXT,
            decision            TEXT NOT NULL,
            shap_values_json    TEXT NOT NULL,
            top_positive_json   TEXT NOT NULL,
            top_negative_json   TEXT NOT NULL,
            decisive_factor     TEXT,
            human_language      TEXT,
            model_version       TEXT,
            created_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, decision_id)
        );
CREATE TABLE ml_feature_health (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            feature_name        TEXT NOT NULL,
            sample_count        INTEGER NOT NULL DEFAULT 0,
            mean_importance     REAL NOT NULL DEFAULT 0,
            last_seen_at        INTEGER,
            disabled            INTEGER NOT NULL DEFAULT 0,
            disabled_reason     TEXT,
            disabled_at         INTEGER,
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, feature_name)
        );
CREATE INDEX idx_mlex_user_env_dec
            ON ml_explanations(user_id, resolved_env, decision_id);
CREATE INDEX idx_mlfh_user_env_feat
            ON ml_feature_health(user_id, resolved_env, feature_name);
CREATE TABLE ml_observability_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_type    TEXT NOT NULL CHECK(event_type IN
                          ('decision_log','raw_features','detector_score',
                           'meta_score','execution_event','fill','pnl',
                           'slippage','latency','reconciliation_status',
                           'drift_status','veto_reason','explainability_snapshot')),
            payload_json  TEXT NOT NULL,
            regime        TEXT,
            pos_id        TEXT,
            ts            INTEGER NOT NULL
        );
CREATE TABLE ml_kpi_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            kpi           TEXT NOT NULL CHECK(kpi IN
                          ('kpi_per_regime','pnl_per_regime','hit_rate_per_regime',
                           'avg_rr','avg_slippage','avg_latency','fill_quality',
                           'confidence_calibration','drift_monitor',
                           'false_breakout_monitor','venue_divergence_monitor')),
            value         REAL NOT NULL,
            regime        TEXT,
            ts            INTEGER NOT NULL
        );
CREATE INDEX idx_mloe_user_env_type_ts
            ON ml_observability_events(user_id, resolved_env, event_type, ts);
CREATE INDEX idx_mlks_user_env_kpi_ts
            ON ml_kpi_snapshots(user_id, resolved_env, kpi, ts);
CREATE INDEX idx_mlks_regime
            ON ml_kpi_snapshots(regime, ts);
CREATE TABLE ml_temporal_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pattern         TEXT NOT NULL CHECK(pattern IN
                            ('seasonality_intraday','day_of_week',
                             'friday_evening','sunday_morning','wednesday_noon',
                             'end_of_month','end_of_quarter',
                             'london_open','new_york_open','asia_drift')),
            sample_count    INTEGER NOT NULL DEFAULT 0,
            mean_outcome    REAL NOT NULL DEFAULT 0,
            regime          TEXT,
            last_seen_at    INTEGER,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, pattern, regime)
        );
CREATE INDEX idx_mlto_user_env_pat_reg
            ON ml_temporal_observations(user_id, resolved_env, pattern, regime);
CREATE TABLE ml_tca_estimates (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                      TEXT,
            exchange                    TEXT NOT NULL,
            order_size_usd              REAL NOT NULL,
            estimated_slippage_bps      REAL NOT NULL,
            estimated_fees_bps          REAL NOT NULL,
            estimated_total_cost_bps    REAL NOT NULL,
            actual_slippage_bps         REAL,
            actual_fees_bps             REAL,
            is_viable                   INTEGER NOT NULL CHECK(is_viable IN (0, 1)),
            expected_edge_bps           REAL,
            created_at                  INTEGER NOT NULL
        );
CREATE INDEX idx_mltca_user_env_ex_ts
            ON ml_tca_estimates(user_id, resolved_env, exchange, created_at);
CREATE INDEX idx_mltca_viable
            ON ml_tca_estimates(is_viable, created_at);
CREATE TABLE ml_thresholds_canonical (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            category        TEXT NOT NULL,
            default_value   REAL NOT NULL,
            description     TEXT,
            version         TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );
CREATE TABLE ml_threshold_overrides (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            threshold_name  TEXT NOT NULL,
            value           REAL NOT NULL,
            regime          TEXT,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlto_user_env_name_reg
            ON ml_threshold_overrides(user_id, resolved_env, threshold_name, regime);
CREATE INDEX idx_mltc_category
            ON ml_thresholds_canonical(category);
CREATE TABLE ml_frequency_mode_state (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mode          TEXT NOT NULL CHECK(mode IN ('SNIPER','SCALP','OBSERVER','ADAPTIVE')),
            since         INTEGER NOT NULL,
            reason        TEXT NOT NULL,
            actor         TEXT NOT NULL,
            regime        TEXT,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_frequency_mode_transitions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            from_mode     TEXT,
            to_mode       TEXT NOT NULL CHECK(to_mode IN ('SNIPER','SCALP','OBSERVER','ADAPTIVE')),
            reason        TEXT NOT NULL,
            actor         TEXT NOT NULL,
            regime        TEXT,
            created_at    INTEGER NOT NULL
        );
CREATE INDEX idx_mlfmt_user_env_ts
            ON ml_frequency_mode_transitions(user_id, resolved_env, created_at);
CREATE TABLE ml_intelligence_checks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            criterion     TEXT NOT NULL CHECK(criterion IN
                          ('knows_regime','knows_context','knows_no_edge',
                           'knows_signal_conflict','knows_execution_compromised',
                           'knows_data_degraded','knows_model_drift',
                           'knows_portfolio_overloaded','knows_when_to_reduce',
                           'knows_when_to_stop','knows_how_to_explain',
                           'knows_how_to_learn_honestly')),
            satisfied     INTEGER NOT NULL CHECK(satisfied IN (0, 1)),
            score         REAL,
            evidence_json TEXT,
            created_at    INTEGER NOT NULL
        );
CREATE INDEX idx_mlic_user_env_crit_ts
            ON ml_intelligence_checks(user_id, resolved_env, criterion, created_at);
CREATE TABLE ml_smart_money_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            signal_type     TEXT NOT NULL CHECK(signal_type IN
                            ('institutional_divergence','venue_divergence',
                             'smart_money_signature','absorption_post_sweep',
                             'hidden_distribution','cluster_short_above',
                             'cluster_long_below','cascade_probability',
                             'heatmap_pressure','liquidation_magnet')),
            sample_count    INTEGER NOT NULL DEFAULT 0,
            mean_strength   REAL NOT NULL DEFAULT 0,
            regime          TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_type, regime)
        );
CREATE INDEX idx_mlsmo_user_env_sig
            ON ml_smart_money_observations(user_id, resolved_env, signal_type);
CREATE TABLE ml_options_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_type TEXT NOT NULL CHECK(observation_type IN
                            ('gex_profile','gamma_pin','gamma_squeeze',
                             'max_pain','expiration_proximity')),
            payload_json    TEXT NOT NULL,
            symbol          TEXT,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mloo_user_env_type_ts
            ON ml_options_observations(user_id, resolved_env, observation_type, created_at);
CREATE TABLE ml_rl_decisions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id          TEXT,
            action_type     TEXT NOT NULL CHECK(action_type IN
                            ('take_partial','activate_trailing','force_exit',
                             'leave_runner','aggressive_reduce')),
            proposed_at     INTEGER,
            allowed         INTEGER NOT NULL DEFAULT 0,
            blockers_json   TEXT NOT NULL DEFAULT '[]',
            executed        INTEGER NOT NULL DEFAULT 0,
            reward          REAL,
            created_at      INTEGER NOT NULL
        );
CREATE TABLE ml_rl_validation_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            stage           TEXT NOT NULL CHECK(stage IN
                            ('simulator','backtest','shadow','probation','live')),
            since           INTEGER NOT NULL,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE INDEX idx_mlrd_user_env_pos
            ON ml_rl_decisions(user_id, resolved_env, pos_id);
CREATE TABLE ml_thinking_traces (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id     TEXT NOT NULL,
            step            TEXT NOT NULL CHECK(step IN
                            ('OBSERVA','CLASIFICA_REGIMUL','VERIFICA_BIAS_GLOBAL',
                             'MAPEAZA_STRUCTURA','IDENTIFICA_LICHIDITATEA',
                             'VERIFICA_PARTICIPAREA_REALA',
                             'VERIFICA_MACRO_CORELATII_OPTIONS_VENUES',
                             'EVALUAZA_RISCUL_SI_EXECUTIA','CALCULEAZA_AVANTAJUL',
                             'DECIDE_SAU_STA','GESTIONEAZA','INVATA')),
            step_index      INTEGER NOT NULL,
            input_json      TEXT,
            output_json     TEXT,
            status          TEXT NOT NULL CHECK(status IN ('OK','SKIPPED','ERROR')),
            duration_ms     INTEGER,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mltt_user_env_dec_step
            ON ml_thinking_traces(user_id, resolved_env, decision_id, step_index);
CREATE INDEX idx_mltt_step_status
            ON ml_thinking_traces(step, status);
CREATE TABLE ml_funding_evaluations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                  TEXT,
            current_funding_rate    REAL NOT NULL,
            time_to_funding_ms      INTEGER NOT NULL,
            estimated_cost_usd      REAL NOT NULL,
            recommendation          TEXT NOT NULL CHECK(recommendation IN ('HOLD','REDUCE','EXIT')),
            should_exit             INTEGER NOT NULL CHECK(should_exit IN (0, 1)),
            reason                  TEXT,
            created_at              INTEGER NOT NULL
        );
CREATE INDEX idx_mlfe_user_env_pos_ts
            ON ml_funding_evaluations(user_id, resolved_env, pos_id, created_at);
CREATE TABLE ml_panic_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            severity        TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            state           TEXT NOT NULL CHECK(state IN ('ACTIVE','CLEARED')),
            triggered_at    INTEGER NOT NULL,
            cleared_at      INTEGER
        );
CREATE INDEX idx_mlpe_user_env_state
            ON ml_panic_events(user_id, resolved_env, state);
CREATE TABLE ml_post_only_orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id          TEXT,
            exchange        TEXT NOT NULL,
            side            TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
            placed_price    REAL NOT NULL,
            shaded_price    REAL NOT NULL,
            reference_best  REAL NOT NULL,
            urgency         TEXT NOT NULL CHECK(urgency IN ('LOW','MEDIUM','HIGH')),
            strategy        TEXT NOT NULL CHECK(strategy IN ('PASSIVE','MODERATE','AGGRESSIVE')),
            outcome         TEXT NOT NULL CHECK(outcome IN ('FILLED','MISSED','PENDING','CANCELLED')),
            filled_price    REAL,
            cost_savings_bps REAL,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlpoo_user_env_ex_ts
            ON ml_post_only_orders(user_id, resolved_env, exchange, created_at);
CREATE TABLE ml_spoofing_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_type      TEXT NOT NULL CHECK(event_type IN
                            ('suspected_spoof','fake_wall_detected',
                             'pulled_orders','layering_pattern')),
            symbol          TEXT,
            severity        REAL NOT NULL DEFAULT 0,
            payload_json    TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlse_user_env_sym_ts
            ON ml_spoofing_events(user_id, resolved_env, symbol, created_at);
CREATE TABLE ml_api_request_queue (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange        TEXT NOT NULL,
            request_type    TEXT NOT NULL,
            priority        TEXT NOT NULL CHECK(priority IN ('CRITICAL','HIGH','NORMAL','LOW')),
            payload_json    TEXT NOT NULL,
            status          TEXT NOT NULL CHECK(status IN ('PENDING','SENT','EXPIRED','DROPPED')),
            deadline_at     INTEGER,
            enqueued_at     INTEGER NOT NULL,
            processed_at    INTEGER
        );
CREATE INDEX idx_mlaq_user_env_ex_prio_status
            ON ml_api_request_queue(user_id, resolved_env, exchange, priority, status);
CREATE TABLE ml_size_ramp_state (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            stage               TEXT NOT NULL CHECK(stage IN
                                ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','COMPLETE')),
            trades_completed    INTEGER NOT NULL DEFAULT 0,
            wins_count          INTEGER NOT NULL DEFAULT 0,
            losses_count        INTEGER NOT NULL DEFAULT 0,
            current_multiplier  REAL NOT NULL DEFAULT 0.25,
            planned_trades      INTEGER NOT NULL,
            started_at          INTEGER NOT NULL,
            completed_at        INTEGER,
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_config_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            config_key      TEXT NOT NULL,
            value_json      TEXT NOT NULL,
            version         TEXT NOT NULL,
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            actor           TEXT NOT NULL,
            reason          TEXT,
            created_at      INTEGER NOT NULL
        );
CREATE TABLE ml_config_rollback_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            config_key      TEXT NOT NULL,
            from_version    TEXT,
            to_version      TEXT NOT NULL,
            reason          TEXT NOT NULL,
            actor           TEXT NOT NULL,
            duration_ms     INTEGER,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlcs_user_env_key_active
            ON ml_config_snapshots(user_id, resolved_env, config_key, is_active);
CREATE INDEX idx_mlcrl_user_env_ts
            ON ml_config_rollback_log(user_id, resolved_env, created_at);
CREATE TABLE ml_runbooks (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            runbook_id          TEXT NOT NULL UNIQUE,
            name                TEXT NOT NULL,
            trigger_signals_json TEXT NOT NULL,
            steps_json          TEXT NOT NULL,
            auto_execute        INTEGER NOT NULL DEFAULT 0,
            severity            TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            created_at          INTEGER NOT NULL
        );
CREATE TABLE ml_runbook_executions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            runbook_id          TEXT NOT NULL,
            mode                TEXT NOT NULL CHECK(mode IN ('AUTO','MANUAL','DRY_RUN')),
            actor               TEXT NOT NULL,
            matched_signals_json TEXT NOT NULL,
            steps_executed      INTEGER NOT NULL DEFAULT 0,
            status              TEXT NOT NULL CHECK(status IN ('EXECUTED','SIMULATED','FAILED')),
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlre_user_env_rb_ts
            ON ml_runbook_executions(user_id, resolved_env, runbook_id, created_at);
CREATE TABLE ml_db_contention_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            operation       TEXT NOT NULL,
            duration_ms     INTEGER NOT NULL,
            lock_wait_ms    INTEGER,
            error_msg       TEXT,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mldcl_user_env_op_ts
            ON ml_db_contention_log(user_id, resolved_env, operation, created_at);
CREATE INDEX idx_mldcl_duration
            ON ml_db_contention_log(duration_ms);
CREATE TABLE ml_mood_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            smoothed_score  REAL NOT NULL,
            sample_count    INTEGER NOT NULL DEFAULT 0,
            last_raw_score  REAL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_mood_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            raw_score       REAL NOT NULL,
            smoothed_score  REAL NOT NULL,
            alpha_used      REAL,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlmh_user_env_ts
            ON ml_mood_history(user_id, resolved_env, created_at);
CREATE TABLE ml_latency_budget_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            task_type       TEXT NOT NULL,
            latency_ms      INTEGER NOT NULL,
            budget_ms       INTEGER NOT NULL,
            accepted        INTEGER NOT NULL CHECK(accepted IN (0,1)),
            drop_reason     TEXT,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mllbl_user_env_task_ts
            ON ml_latency_budget_log(user_id, resolved_env, task_type, created_at);
CREATE INDEX idx_mllbl_accepted
            ON ml_latency_budget_log(accepted, created_at);
CREATE TABLE ml_telegram_pushes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_type      TEXT NOT NULL,
            severity        TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
            message         TEXT NOT NULL,
            payload_json    TEXT NOT NULL,
            dedup_key       TEXT,
            delivery_status TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK(delivery_status IN ('PENDING','SENT','FAILED','DEDUPED')),
            created_at      INTEGER NOT NULL,
            delivered_at    INTEGER
        );
CREATE INDEX idx_mltp_user_env_dedup
            ON ml_telegram_pushes(user_id, resolved_env, dedup_key, created_at);
CREATE TABLE ml_operator_presence (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            state               TEXT NOT NULL CHECK(state IN ('ACTIVE','AWAY','UNKNOWN')),
            last_activity_at    INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            explicit_reason     TEXT,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_operator_activity_log (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            activity_type       TEXT NOT NULL,
            source              TEXT,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mloal_user_env_ts
            ON ml_operator_activity_log(user_id, resolved_env, created_at);
CREATE TABLE ml_quiet_hours (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            windows_json    TEXT NOT NULL,
            timezone        TEXT NOT NULL DEFAULT 'UTC',
            actor           TEXT NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_omega_reactions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id              TEXT,
            outcome_type        TEXT NOT NULL CHECK(outcome_type IN
                                ('big_win','win','breakeven','loss','big_loss','missed_opportunity')),
            reaction_text       TEXT NOT NULL,
            trade_context_json  TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlor_user_env_ts
            ON ml_omega_reactions(user_id, resolved_env, created_at);
CREATE TABLE ml_no_trade_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                  TEXT,
            signal_candidate_json   TEXT NOT NULL,
            veto_reason             TEXT NOT NULL,
            score                   REAL NOT NULL,
            threshold               REAL NOT NULL,
            regime                  TEXT,
            expected_direction      TEXT,
            created_at              INTEGER NOT NULL
        );
CREATE TABLE ml_no_trade_outcomes (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            no_trade_id             INTEGER NOT NULL,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            market_move_r           REAL NOT NULL,
            direction_matched       INTEGER NOT NULL CHECK(direction_matched IN (0,1)),
            outcome_type            TEXT NOT NULL CHECK(outcome_type IN
                                    ('MISSED_OPPORTUNITY','GOOD_SKIP','NEUTRAL','PENDING')),
            validated_at            INTEGER NOT NULL
        );
CREATE INDEX idx_mlntd_user_env_reason_ts
            ON ml_no_trade_decisions(user_id, resolved_env, veto_reason, created_at);
CREATE INDEX idx_mlnto_user_env_outcome
            ON ml_no_trade_outcomes(user_id, resolved_env, outcome_type);
CREATE TABLE ml_loss_streak_state (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            consecutive_losses  INTEGER NOT NULL DEFAULT 0,
            size_multiplier     REAL NOT NULL DEFAULT 1.0,
            last_win_at         INTEGER,
            recovery_progress   INTEGER NOT NULL DEFAULT 0,
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_adversarial_runs (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id                 TEXT NOT NULL UNIQUE,
            name                        TEXT NOT NULL,
            type                        TEXT NOT NULL CHECK(type IN
                                        ('veto_bypass','state_machine_edge','api_saturation',
                                         'latency_injection','feed_desync','flash_crash')),
            payload_json                TEXT NOT NULL,
            expected_safety_trigger     TEXT NOT NULL,
            severity                    TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            created_at                  INTEGER NOT NULL
        );
CREATE TABLE ml_adversarial_results (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            scenario_id         TEXT NOT NULL,
            mode                TEXT NOT NULL CHECK(mode IN ('SIMULATED','ACTUAL')),
            passed              INTEGER NOT NULL CHECK(passed IN (0,1)),
            observations_json   TEXT NOT NULL,
            duration_ms         INTEGER,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlares_user_env_sc_ts
            ON ml_adversarial_results(user_id, resolved_env, scenario_id, created_at);
CREATE INDEX idx_mlares_passed
            ON ml_adversarial_results(scenario_id, passed);
CREATE TABLE ml_latency_measurements (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            e2e_ms                  INTEGER NOT NULL,
            feed_to_decision_ms     INTEGER,
            decision_to_order_ms    INTEGER,
            order_to_ack_ms         INTEGER,
            mode                    TEXT NOT NULL CHECK(mode IN
                                    ('SCALPING_ALLOWED','SWING_ONLY','OBSERVER_ONLY')),
            created_at              INTEGER NOT NULL
        );
CREATE TABLE ml_latency_modes (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mode                    TEXT NOT NULL CHECK(mode IN
                                    ('SCALPING_ALLOWED','SWING_ONLY','OBSERVER_ONLY')),
            current_latency_ms      INTEGER NOT NULL,
            updated_at              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE INDEX idx_mllm_user_env_ts
            ON ml_latency_measurements(user_id, resolved_env, created_at);
CREATE TABLE ml_override_performance (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pos_id                      TEXT,
            symbol                      TEXT,
            direction                   TEXT,
            override_type               TEXT NOT NULL CHECK(override_type IN
                                        ('entry','exit','size','sl','tp','cancel','skip')),
            original_decision_json      TEXT NOT NULL,
            final_decision_json         TEXT NOT NULL,
            actor                       TEXT NOT NULL,
            actual_pnl                  REAL,
            hypothetical_bot_pnl        REAL,
            delta                       REAL,
            created_at                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlop_user_env_ts
            ON ml_override_performance(user_id, resolved_env, created_at);
CREATE TABLE ml_inactivity_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            last_trade_at   INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_ensemble_votes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            model_type          TEXT NOT NULL,
            vote_action         TEXT NOT NULL CHECK(vote_action IN ('BUY','SELL','NO_TRADE')),
            vote_confidence     REAL NOT NULL,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlev_user_env_dec
            ON ml_ensemble_votes(user_id, resolved_env, decision_id);
CREATE INDEX idx_mlev_model_action
            ON ml_ensemble_votes(model_type, vote_action);
CREATE TABLE ml_causal_chains (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            chain_id            TEXT NOT NULL UNIQUE,
            name                TEXT NOT NULL,
            edges_json          TEXT NOT NULL,
            expected_outcome    TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
CREATE TABLE ml_causal_observations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            chain_id            TEXT NOT NULL,
            state               TEXT NOT NULL CHECK(state IN
                                ('LATENT','TRIGGERED','RESOLVED','INVALIDATED')),
            trigger_event_json  TEXT,
            evidence_json       TEXT,
            actual_outcome      TEXT,
            matched             INTEGER,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlco_user_env_chain
            ON ml_causal_observations(user_id, resolved_env, chain_id);
CREATE INDEX idx_mlco_state
            ON ml_causal_observations(state, created_at);
CREATE TABLE ml_strategy_crowding (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_type      TEXT NOT NULL CHECK(setup_type IN
                            ('liquidity_sweep','funding_extreme','cross_venue_div',
                             'stop_run_reclaim','cvd_divergence','breakout',
                             'mean_reversion','momentum_continuation')),
            hit_rate        REAL NOT NULL,
            slippage_bps    REAL,
            created_at      INTEGER NOT NULL
        );
CREATE INDEX idx_mlsc_user_env_setup_ts
            ON ml_strategy_crowding(user_id, resolved_env, setup_type, created_at);
CREATE TABLE ml_counterfactual_runs (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id            TEXT NOT NULL,
            param_type          TEXT NOT NULL CHECK(param_type IN ('entry','sl','size','tp')),
            actual_value        REAL NOT NULL,
            alt_value           REAL NOT NULL,
            actual_pnl          REAL NOT NULL,
            alt_pnl             REAL NOT NULL,
            would_have_hit_sl   INTEGER NOT NULL CHECK(would_have_hit_sl IN (0,1)),
            would_have_hit_tp   INTEGER NOT NULL CHECK(would_have_hit_tp IN (0,1)),
            improvement         REAL NOT NULL,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlcf_user_env_ts
            ON ml_counterfactual_runs(user_id, resolved_env, created_at);
CREATE INDEX idx_mlcf_user_env_param
            ON ml_counterfactual_runs(user_id, resolved_env, param_type, created_at);
CREATE INDEX idx_mlcf_trade
            ON ml_counterfactual_runs(trade_id);
CREATE TABLE ml_pit_snapshots (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_type       TEXT NOT NULL CHECK(snapshot_type IN
                                ('decision','tick','event','manual')),
            ts                  INTEGER NOT NULL,
            market_state_json   TEXT,
            feature_state_json  TEXT,
            model_output_json   TEXT,
            vetos_json          TEXT,
            scores_json         TEXT,
            order_intent_json   TEXT,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlpit_user_env_ts
            ON ml_pit_snapshots(user_id, resolved_env, ts);
CREATE INDEX idx_mlpit_user_env_type_ts
            ON ml_pit_snapshots(user_id, resolved_env, snapshot_type, ts);
CREATE TABLE ml_queue_fill_observations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol                  TEXT NOT NULL,
            side                    TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
            queue_rank_est          INTEGER NOT NULL,
            fill_prob_est           REAL NOT NULL,
            decay_rate              REAL NOT NULL,
            maker_cost_bps          REAL NOT NULL,
            taker_cost_bps          REAL NOT NULL,
            decision                TEXT NOT NULL CHECK(decision IN ('maker','taker','reprice','abstain')),
            actual_filled           INTEGER NOT NULL CHECK(actual_filled IN (0,1)),
            time_to_fill_ms         INTEGER,
            cancelled               INTEGER NOT NULL CHECK(cancelled IN (0,1)),
            cancel_count            INTEGER NOT NULL DEFAULT 0,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlqf_user_env_symbol_ts
            ON ml_queue_fill_observations(user_id, resolved_env, symbol, ts);
CREATE INDEX idx_mlqf_user_env_decision_ts
            ON ml_queue_fill_observations(user_id, resolved_env, decision, ts);
CREATE TABLE ml_adversarial_mc_runs (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            scenario_type           TEXT NOT NULL CHECK(scenario_type IN
                                    ('funding_spike','oi_cascade','venue_outage',
                                     'flash_crash','liquidity_evaporation')),
            scenario_params_json    TEXT,
            num_simulations         INTEGER NOT NULL,
            base_pnl                REAL NOT NULL,
            mc_mean_pnl             REAL NOT NULL,
            mc_p5_pnl               REAL NOT NULL,
            mc_p50_pnl              REAL NOT NULL,
            mc_p95_pnl              REAL NOT NULL,
            mc_p99_pnl              REAL NOT NULL,
            max_drawdown            REAL NOT NULL,
            max_loss                REAL NOT NULL,
            stress_factor           REAL NOT NULL,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlamc_user_env_scenario_ts
            ON ml_adversarial_mc_runs(user_id, resolved_env, scenario_type, ts);
CREATE TABLE ml_execution_intents (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            intent_id       TEXT NOT NULL UNIQUE,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            action_type     TEXT NOT NULL CHECK(action_type IN
                            ('place_order','cancel_order','modify_order','close_position')),
            payload_hash    TEXT NOT NULL,
            payload_json    TEXT NOT NULL,
            status          TEXT NOT NULL CHECK(status IN
                            ('PENDING','CONFIRMED','REJECTED','EXPIRED')),
            order_id        TEXT,
            fill_id         TEXT,
            position_id     TEXT,
            reject_reason   TEXT,
            created_at      INTEGER NOT NULL,
            confirmed_at    INTEGER
        );
CREATE INDEX idx_mlei_user_env_status_ts
            ON ml_execution_intents(user_id, resolved_env, status, created_at);
CREATE INDEX idx_mlei_user_env_payload_hash
            ON ml_execution_intents(user_id, resolved_env, payload_hash);
CREATE TABLE ml_factor_exposures (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            position_id     TEXT NOT NULL,
            btc_beta        REAL NOT NULL,
            market_beta     REAL NOT NULL,
            vol_factor      REAL NOT NULL,
            liquidity_factor  REAL NOT NULL,
            funding_factor  REAL NOT NULL,
            macro_factor    REAL NOT NULL,
            gross_exposure  REAL NOT NULL,
            ts              INTEGER NOT NULL
        );
CREATE TABLE ml_netting_decisions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_type       TEXT NOT NULL CHECK(decision_type IN
                                ('NET','HEDGE','REDUCE','REPLACE','HOLD')),
            positions_json      TEXT NOT NULL,
            dominant_factor     TEXT NOT NULL,
            factor_overlap_score REAL NOT NULL,
            recommended_action  TEXT,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlnd_user_env_ts
            ON ml_netting_decisions(user_id, resolved_env, ts);
CREATE TABLE ml_utility_evaluations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            expectancy_after_costs  REAL NOT NULL,
            tail_risk_penalty   REAL NOT NULL,
            turnover_penalty    REAL NOT NULL,
            latency_penalty     REAL NOT NULL,
            concentration_penalty  REAL NOT NULL,
            crowding_penalty    REAL NOT NULL,
            total_utility       REAL NOT NULL,
            weights_json        TEXT,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlue_user_env_ts
            ON ml_utility_evaluations(user_id, resolved_env, ts);
CREATE INDEX idx_mlue_decision_id
            ON ml_utility_evaluations(decision_id);
CREATE TABLE ml_source_trust (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            source_id           TEXT NOT NULL,
            trust_score         REAL NOT NULL,
            total_observations  INTEGER NOT NULL DEFAULT 0,
            anomaly_count       INTEGER NOT NULL DEFAULT 0,
            last_anomaly_ts     INTEGER,
            status              TEXT NOT NULL CHECK(status IN
                                ('TRUSTED','DEGRADED','EXCLUDED')),
            updated_at          INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, source_id)
        );
CREATE INDEX idx_mlst_user_env_status
            ON ml_source_trust(user_id, resolved_env, status);
CREATE TABLE ml_anomaly_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            source_id       TEXT NOT NULL,
            anomaly_type    TEXT NOT NULL CHECK(anomaly_type IN
                            ('impossible_print','ts_spoof','packet_corrupt',
                             'venue_anomaly','sentiment_burst','signal_burst')),
            severity        TEXT NOT NULL CHECK(severity IN ('low','med','high')),
            payload_hash    TEXT,
            details_json    TEXT,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlae_user_env_source_ts
            ON ml_anomaly_events(user_id, resolved_env, source_id, ts);
CREATE INDEX idx_mlae_anomaly_type_ts
            ON ml_anomaly_events(anomaly_type, ts);
CREATE TABLE ml_invariant_violations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            invariant_id    TEXT NOT NULL,
            severity        TEXT NOT NULL CHECK(severity IN ('warn','critical')),
            context_json    TEXT,
            snapshot_id     TEXT,
            action_taken    TEXT NOT NULL CHECK(action_taken IN
                            ('lock','alert','snapshot','forensic_log','noop')),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mliv_user_env_inv_ts
            ON ml_invariant_violations(user_id, resolved_env, invariant_id, ts);
CREATE INDEX idx_mliv_severity_ts
            ON ml_invariant_violations(severity, ts);
CREATE TABLE ml_fingerprint_observations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_type              TEXT NOT NULL,
            entry_delay_ms          INTEGER NOT NULL,
            size_jitter_pct         REAL NOT NULL,
            order_type_used         TEXT NOT NULL CHECK(order_type_used IN
                                    ('market','limit','post_only','ioc')),
            actual_slippage_bps     REAL NOT NULL,
            expected_slippage_bps   REAL NOT NULL,
            slippage_excess_bps     REAL NOT NULL,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlfo_user_env_setup_ts
            ON ml_fingerprint_observations(user_id, resolved_env, setup_type, ts);
CREATE TABLE ml_fingerprint_alerts (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_type              TEXT NOT NULL,
            slippage_trend_bps      REAL NOT NULL,
            samples_in_window       INTEGER NOT NULL,
            severity                TEXT NOT NULL CHECK(severity IN ('warn','critical')),
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlfa_user_env_setup_ts
            ON ml_fingerprint_alerts(user_id, resolved_env, setup_type, ts);
CREATE TABLE ml_heartbeat_state (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            last_heartbeat_ts       INTEGER NOT NULL,
            expected_interval_ms    INTEGER NOT NULL,
            staleness_threshold_ms  INTEGER NOT NULL,
            dead_threshold_ms       INTEGER NOT NULL,
            status                  TEXT NOT NULL CHECK(status IN
                                    ('HEALTHY','STALE','DEAD')),
            last_check_ts           INTEGER,
            updated_at              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE INDEX idx_mlhs_user_env
            ON ml_heartbeat_state(user_id, resolved_env);
CREATE TABLE ml_dead_man_emergencies (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trigger_reason              TEXT NOT NULL CHECK(trigger_reason IN
                                        ('heartbeat_dead','manual','external_watchdog')),
            positions_closed_count      INTEGER,
            orders_cancelled_count      INTEGER,
            alert_sent                  INTEGER NOT NULL DEFAULT 0 CHECK(alert_sent IN (0,1)),
            completed_at                INTEGER,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mldme_user_env_ts
            ON ml_dead_man_emergencies(user_id, resolved_env, ts);
CREATE TABLE ml_regime_history (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            regime_type         TEXT NOT NULL CHECK(regime_type IN
                                ('trend_up','trend_down','range','chop','volatile_expansion')),
            start_ts            INTEGER NOT NULL,
            end_ts              INTEGER,
            duration_ms         INTEGER,
            terminated_naturally INTEGER CHECK(terminated_naturally IN (0,1)),
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlrh_user_env_type_ts
            ON ml_regime_history(user_id, resolved_env, regime_type, start_ts);
CREATE TABLE ml_regime_current_state (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            regime_type         TEXT NOT NULL CHECK(regime_type IN
                                ('trend_up','trend_down','range','chop','volatile_expansion')),
            started_at          INTEGER NOT NULL,
            history_id          INTEGER,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_episodic_archive (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            archive_id              TEXT NOT NULL,
            label                   TEXT NOT NULL,
            start_ts                INTEGER NOT NULL,
            end_ts                  INTEGER NOT NULL,
            fingerprint_vector_json TEXT NOT NULL,
            outcome_summary         TEXT,
            lessons_json            TEXT,
            created_at              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, archive_id)
        );
CREATE INDEX idx_mlea_user_env
            ON ml_episodic_archive(user_id, resolved_env);
CREATE TABLE ml_fingerprint_matches (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            query_fingerprint_json      TEXT NOT NULL,
            archive_id                  TEXT NOT NULL,
            similarity_score            REAL NOT NULL,
            ranked_position             INTEGER NOT NULL,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlfm_user_env_ts
            ON ml_fingerprint_matches(user_id, resolved_env, ts);
CREATE TABLE ml_compliance_violations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_type  TEXT NOT NULL CHECK(violation_type IN
                            ('quote_stuff','wash_trade','event_sync','cancel_rate','other')),
            severity        TEXT NOT NULL CHECK(severity IN ('info','warn','critical')),
            context_json    TEXT,
            action_taken    TEXT,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlcv_user_env_type_ts
            ON ml_compliance_violations(user_id, resolved_env, violation_type, ts);
CREATE TABLE ml_economic_justifications (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                     TEXT NOT NULL,
            action_type                     TEXT NOT NULL,
            justification_text              TEXT NOT NULL,
            supporting_signals_json         TEXT,
            expected_economic_outcome       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlej_user_env_decision
            ON ml_economic_justifications(user_id, resolved_env, decision_id);
CREATE INDEX idx_mlej_user_env_ts
            ON ml_economic_justifications(user_id, resolved_env, ts);
CREATE TABLE ml_l2_depth_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange        TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            bids_json       TEXT NOT NULL,
            asks_json       TEXT NOT NULL,
            mid_price       REAL NOT NULL,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mll2_user_env_ex_sym_ts
            ON ml_l2_depth_snapshots(user_id, resolved_env, exchange, symbol, ts);
CREATE TABLE ml_slippage_calibration (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange        TEXT NOT NULL,
            symbol          TEXT NOT NULL,
            sample_count    INTEGER NOT NULL,
            alpha           REAL NOT NULL,
            beta            REAL NOT NULL,
            r_squared       REAL NOT NULL,
            last_updated    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, exchange, symbol)
        );
CREATE INDEX idx_mlsc_user_env_ex_sym
            ON ml_slippage_calibration(user_id, resolved_env, exchange, symbol);
CREATE TABLE ml_fill_simulations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            exchange                    TEXT NOT NULL,
            symbol                      TEXT NOT NULL,
            mode                        TEXT NOT NULL CHECK(mode IN ('backtest','shadow')),
            order_side                  TEXT NOT NULL CHECK(order_side IN ('LONG','SHORT')),
            order_size                  REAL NOT NULL,
            simulated_avg_price         REAL NOT NULL,
            simulated_slippage_bps      REAL NOT NULL,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlfs_user_env_mode_ts
            ON ml_fill_simulations(user_id, resolved_env, mode, ts);
CREATE INDEX idx_mlfs_user_env_ex_sym_ts
            ON ml_fill_simulations(user_id, resolved_env, exchange, symbol, ts);
CREATE TABLE ml_drift_orchestration_state (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            model_id        TEXT NOT NULL,
            status          TEXT NOT NULL CHECK(status IN
                            ('HEALTHY','DEGRADED','RETRAIN_QUEUED',
                             'CANARY_RUNNING','BLOCKED')),
            psi             REAL,
            brier           REAL,
            ks              REAL,
            last_trigger_ts INTEGER,
            updated_at      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, model_id)
        );
CREATE INDEX idx_mldos_user_env_status
            ON ml_drift_orchestration_state(user_id, resolved_env, status);
CREATE TABLE ml_retrain_canary_runs (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            model_id            TEXT NOT NULL,
            canary_run_id       TEXT NOT NULL UNIQUE,
            trigger_metric      TEXT NOT NULL CHECK(trigger_metric IN ('psi','brier','ks')),
            trigger_value       REAL NOT NULL,
            status              TEXT NOT NULL CHECK(status IN
                                ('PENDING','RUNNING','PASSED','FAILED')),
            live_blocked        INTEGER NOT NULL CHECK(live_blocked IN (0,1)),
            metrics_json        TEXT,
            started_at          INTEGER NOT NULL,
            completed_at        INTEGER,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlrcr_user_env_model_ts
            ON ml_retrain_canary_runs(user_id, resolved_env, model_id, ts);
CREATE TABLE ml_xai_explanations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            action              TEXT NOT NULL,
            top_factors_json    TEXT NOT NULL,
            counterfactual_json TEXT,
            confidence_level    REAL NOT NULL,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlxe_user_env_decision
            ON ml_xai_explanations(user_id, resolved_env, decision_id);
CREATE INDEX idx_mlxe_user_env_ts
            ON ml_xai_explanations(user_id, resolved_env, ts);
CREATE TABLE ml_conformal_calibration (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trading_mode            TEXT NOT NULL CHECK(trading_mode IN
                                    ('scalp','intraday','swing','news_risk')),
            regime_type             TEXT NOT NULL,
            coverage_target         REAL NOT NULL,
            calibration_scores_json TEXT NOT NULL,
            n_calibration_samples   INTEGER NOT NULL,
            last_updated            INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, trading_mode, regime_type)
        );
CREATE INDEX idx_mlcc_user_env_mode_regime
            ON ml_conformal_calibration(user_id, resolved_env, trading_mode, regime_type);
CREATE TABLE ml_conformal_decisions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL,
            trading_mode        TEXT NOT NULL CHECK(trading_mode IN
                                ('scalp','intraday','swing','news_risk')),
            regime_type         TEXT NOT NULL,
            prediction_set_size INTEGER NOT NULL,
            conformal_score     REAL NOT NULL,
            coverage_target     REAL NOT NULL,
            in_coverage_zone    INTEGER NOT NULL CHECK(in_coverage_zone IN (0,1)),
            decision_action     TEXT NOT NULL CHECK(decision_action IN
                                ('TRADE','NO_TRADE','WAIT')),
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlcd_user_env_mode_ts
            ON ml_conformal_decisions(user_id, resolved_env, trading_mode, ts);
CREATE INDEX idx_mlcd_user_env_regime_ts
            ON ml_conformal_decisions(user_id, resolved_env, regime_type, ts);
CREATE TABLE ml_thesis_graphs (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thesis_id               TEXT NOT NULL UNIQUE,
            position_id             TEXT,
            nodes_json              TEXT NOT NULL,
            edges_json              TEXT NOT NULL,
            break_conditions_json   TEXT,
            status                  TEXT NOT NULL CHECK(status IN
                                    ('ACTIVE','PARTIAL_DEGRADED','INVALID',
                                     'CONFIRMED_STRENGTHENED')),
            created_at              INTEGER NOT NULL,
            last_updated            INTEGER NOT NULL
        );
CREATE INDEX idx_mltg_user_env_status
            ON ml_thesis_graphs(user_id, resolved_env, status);
CREATE TABLE ml_thesis_evaluations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thesis_id           TEXT NOT NULL,
            evaluation_ts       INTEGER NOT NULL,
            overall_health      TEXT NOT NULL CHECK(overall_health IN
                                ('active','degraded','invalid','strengthened')),
            failing_nodes_json  TEXT,
            action_recommended  TEXT NOT NULL CHECK(action_recommended IN
                                ('HOLD','EXIT_PARTIAL','EXIT_FULL','SCALE_UP')),
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlte_user_env_thesis_ts
            ON ml_thesis_evaluations(user_id, resolved_env, thesis_id, ts);
CREATE TABLE ml_ood_manifold (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            dimension           TEXT NOT NULL CHECK(dimension IN
                                ('feature_vector','regime_state','microstructure_state',
                                 'macro_context','portfolio_state')),
            reference_points_json TEXT NOT NULL,
            n_samples           INTEGER NOT NULL,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, dimension)
        );
CREATE INDEX idx_mlom_user_env_dim
            ON ml_ood_manifold(user_id, resolved_env, dimension);
CREATE TABLE ml_ood_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id             TEXT NOT NULL,
            novelty_score           REAL NOT NULL,
            dimension_scores_json   TEXT NOT NULL,
            classification          TEXT NOT NULL CHECK(classification IN
                                    ('drift_slow','local_outlier','new_valid',
                                     'dangerous_unseen')),
            action                  TEXT NOT NULL CHECK(action IN
                                    ('continue_normal','reduce_size',
                                     'observer','alert')),
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlod_user_env_classif_ts
            ON ml_ood_decisions(user_id, resolved_env, classification, ts);
CREATE INDEX idx_mlod_user_env_action_ts
            ON ml_ood_decisions(user_id, resolved_env, action, ts);
CREATE TABLE ml_evidence_support (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_key                   TEXT NOT NULL,
            setup_type                  TEXT NOT NULL,
            regime_type                 TEXT NOT NULL,
            asset                       TEXT NOT NULL,
            timeframe                   TEXT NOT NULL,
            total_observations          INTEGER NOT NULL DEFAULT 0,
            win_count                   INTEGER NOT NULL DEFAULT 0,
            quality_weighted_score      REAL NOT NULL DEFAULT 0,
            recent_observations         INTEGER NOT NULL DEFAULT 0,
            oldest_ts                   INTEGER,
            last_updated                INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, setup_key)
        );
CREATE INDEX idx_mles_user_env_type
            ON ml_evidence_support(user_id, resolved_env, setup_type);
CREATE TABLE ml_setup_maturity (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_key               TEXT NOT NULL,
            maturity_class          TEXT NOT NULL CHECK(maturity_class IN
                                    ('observational','shadow','probation','mature')),
            authority_level         TEXT NOT NULL CHECK(authority_level IN
                                    ('none','reduced','full')),
            evidence_sufficient     INTEGER NOT NULL CHECK(evidence_sufficient IN (0,1)),
            size_multiplier         REAL NOT NULL,
            last_classified_ts      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, setup_key)
        );
CREATE INDEX idx_mlsm_user_env_class
            ON ml_setup_maturity(user_id, resolved_env, maturity_class);
CREATE TABLE ml_debate_sessions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            debate_id                   TEXT NOT NULL UNIQUE,
            proposer_thesis             TEXT,
            critic_concerns_json        TEXT,
            risk_prosecutor_args_json   TEXT,
            judge_verdict               TEXT CHECK(judge_verdict IN
                                        ('LONG','SHORT','NO_TRADE','WAIT','REDUCE')),
            pro_score                   REAL NOT NULL DEFAULT 0,
            con_score                   REAL NOT NULL DEFAULT 0,
            vetoed_by                   TEXT NOT NULL DEFAULT 'none' CHECK(vetoed_by IN
                                        ('none','critic','risk_prosecutor','both')),
            explanation                 TEXT,
            created_at                  INTEGER NOT NULL,
            verdict_ts                  INTEGER
        );
CREATE INDEX idx_mlds_user_env_verdict
            ON ml_debate_sessions(user_id, resolved_env, judge_verdict);
CREATE TABLE ml_role_performance (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            role                TEXT NOT NULL CHECK(role IN
                                ('proposer','critic','risk_prosecutor','judge')),
            total_decisions     INTEGER NOT NULL DEFAULT 0,
            correct_calls       INTEGER NOT NULL DEFAULT 0,
            false_positives     INTEGER NOT NULL DEFAULT 0,
            false_negatives     INTEGER NOT NULL DEFAULT 0,
            quality_score       REAL NOT NULL DEFAULT 0,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, role)
        );
CREATE TABLE ml_meta_adaptation_episodes (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            episode_id                  TEXT NOT NULL UNIQUE,
            from_regime                 TEXT NOT NULL,
            to_regime                   TEXT NOT NULL,
            detection_ts                INTEGER NOT NULL,
            recalibration_complete_ts   INTEGER,
            samples_used                INTEGER NOT NULL DEFAULT 0,
            recalibration_quality_score REAL,
            status                      TEXT NOT NULL CHECK(status IN
                                        ('DETECTING','ADAPTING','CALIBRATED','FAILED')),
            failure_reason              TEXT,
            created_at                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlmae_user_env_status_ts
            ON ml_meta_adaptation_episodes(user_id, resolved_env, status, created_at);
CREATE TABLE ml_meta_baseline_speed (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            avg_adaptation_hours        REAL NOT NULL DEFAULT 0,
            p50_samples_to_calibrate    INTEGER NOT NULL DEFAULT 0,
            p95_samples_to_calibrate    INTEGER NOT NULL DEFAULT 0,
            episodes_observed           INTEGER NOT NULL DEFAULT 0,
            last_updated                INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env)
        );
CREATE TABLE ml_signal_mi_observations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            signal_id           TEXT NOT NULL,
            signal_value_bin    INTEGER NOT NULL CHECK(signal_value_bin >= 0 AND signal_value_bin <= 9),
            outcome             TEXT NOT NULL CHECK(outcome IN ('win','loss','scratch')),
            count               INTEGER NOT NULL DEFAULT 0,
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_id, signal_value_bin, outcome)
        );
CREATE INDEX idx_mlsmo_user_env_signal
            ON ml_signal_mi_observations(user_id, resolved_env, signal_id);
CREATE TABLE ml_signal_mi_scores (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            signal_id                   TEXT NOT NULL,
            mutual_information_bits     REAL NOT NULL,
            joint_entropy_bits          REAL NOT NULL,
            sample_count                INTEGER NOT NULL,
            redundancy_partners_json    TEXT,
            synergy_partners_json       TEXT,
            last_computed               INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_id)
        );
CREATE INDEX idx_mlsms_user_env_mi
            ON ml_signal_mi_scores(user_id, resolved_env, mutual_information_bits);
CREATE TABLE ml_intervention_predictions (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            intervention_id                     TEXT NOT NULL UNIQUE,
            action_type                         TEXT NOT NULL CHECK(action_type IN
                                                ('market_buy','market_sell','limit_buy','limit_sell')),
            size                                REAL NOT NULL,
            baseline_state_json                 TEXT,
            predicted_price_perturbation_bps    REAL NOT NULL,
            predicted_queue_shift               REAL NOT NULL,
            predicted_signal_emission           REAL NOT NULL,
            predicted_second_order_risk         REAL NOT NULL,
            predicted_second_order_json         TEXT,
            ts                                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlip_user_env_action_ts
            ON ml_intervention_predictions(user_id, resolved_env, action_type, ts);
CREATE TABLE ml_intervention_outcomes (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            intervention_id                 TEXT NOT NULL,
            actual_price_perturbation_bps   REAL NOT NULL,
            actual_queue_shift              REAL NOT NULL,
            actual_reaction_score           REAL NOT NULL,
            prediction_error_score          REAL NOT NULL,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlio_intervention
            ON ml_intervention_outcomes(intervention_id);
CREATE INDEX idx_mlio_user_env_ts
            ON ml_intervention_outcomes(user_id, resolved_env, ts);
CREATE TABLE ml_belief_propagation_log (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thesis_id               TEXT NOT NULL,
            source_node_id          TEXT NOT NULL,
            source_old_conf         REAL NOT NULL,
            source_new_conf         REAL NOT NULL,
            propagation_chain_json  TEXT NOT NULL,
            propagation_depth       INTEGER NOT NULL,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlbpl_user_env_thesis_ts
            ON ml_belief_propagation_log(user_id, resolved_env, thesis_id, ts);
CREATE TABLE ml_inactivity_baseline_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            asset           TEXT NOT NULL,
            hodl_quantity   REAL NOT NULL,
            mark_price      REAL NOT NULL,
            hodl_value      REAL NOT NULL,
            initial_value   REAL NOT NULL,
            ts              INTEGER NOT NULL,
            last_updated    INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, asset)
        );
CREATE INDEX idx_mlibs_user_env_asset
            ON ml_inactivity_baseline_snapshots(user_id, resolved_env, asset);
CREATE TABLE ml_alpha_observations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            period_id       TEXT NOT NULL,
            asset           TEXT NOT NULL,
            bot_pnl         REAL NOT NULL,
            baseline_pnl    REAL NOT NULL,
            alpha_real      REAL NOT NULL,
            alpha_pct       REAL NOT NULL,
            market_regime   TEXT NOT NULL CHECK(market_regime IN
                            ('bull','bear','range','high_vol','low_vol')),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlao_user_env_period
            ON ml_alpha_observations(user_id, resolved_env, period_id);
CREATE INDEX idx_mlao_user_env_ts
            ON ml_alpha_observations(user_id, resolved_env, ts);
CREATE TABLE ml_horizon_ownership (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            position_id         TEXT NOT NULL,
            thesis_horizon      TEXT NOT NULL CHECK(thesis_horizon IN
                                ('scalp','intraday','swing','macro_defensive')),
            owner_timeframe     TEXT NOT NULL CHECK(owner_timeframe IN
                                ('HTF','MTF','LTF','micro')),
            assigned_at         INTEGER NOT NULL,
            status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RETIRED')),
            retired_at          INTEGER,
            UNIQUE(user_id, resolved_env, position_id)
        );
CREATE INDEX idx_mlho_user_env_status
            ON ml_horizon_ownership(user_id, resolved_env, status);
CREATE TABLE ml_horizon_conflicts (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            position_id         TEXT NOT NULL,
            signal_timeframe    TEXT NOT NULL CHECK(signal_timeframe IN
                                ('HTF','MTF','LTF','micro')),
            signal_strength     REAL NOT NULL,
            conflict_score      REAL NOT NULL,
            action_recommended  TEXT NOT NULL CHECK(action_recommended IN
                                ('ignore','hedge','reduce','exit')),
            resolution_reasoning TEXT,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlhc_user_env_position_ts
            ON ml_horizon_conflicts(user_id, resolved_env, position_id, ts);
CREATE TABLE ml_label_purity_scores (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id                    TEXT NOT NULL UNIQUE,
            label_classification        TEXT NOT NULL CHECK(label_classification IN
                                        ('clean','noisy','censored','excluded')),
            purity_score                REAL NOT NULL,
            sample_weight               REAL NOT NULL,
            outcome                     TEXT NOT NULL,
            contamination_reasons_json  TEXT,
            last_updated                INTEGER NOT NULL,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mllps_user_env_class
            ON ml_label_purity_scores(user_id, resolved_env, label_classification);
CREATE TABLE ml_contamination_events (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id            TEXT NOT NULL,
            contamination_type  TEXT NOT NULL CHECK(contamination_type IN
                                ('stiri_majore','exchange_outage','venue_anomaly',
                                 'spread_spike','feed_degradation','execution_failure',
                                 'forced_flatten_extern','dead_man_event')),
            severity            TEXT NOT NULL CHECK(severity IN ('low','med','high')),
            details_json        TEXT,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlce_user_env_trade_ts
            ON ml_contamination_events(user_id, resolved_env, trade_id, ts);
CREATE INDEX idx_mlce_user_env_type_ts
            ON ml_contamination_events(user_id, resolved_env, contamination_type, ts);
CREATE TABLE ml_opportunity_candidates (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            opportunity_id      TEXT NOT NULL UNIQUE,
            symbol              TEXT NOT NULL,
            opportunity_score   REAL NOT NULL,
            capital_required    REAL NOT NULL,
            margin_required     REAL NOT NULL,
            classification      TEXT NOT NULL CHECK(classification IN
                                ('best_trade_available','good_but_inferior',
                                 'valid_but_crowded','valid_but_execution_poor')),
            status              TEXT NOT NULL CHECK(status IN
                                ('PENDING','ACCEPTED','DEFERRED','REPLACED','REJECTED')),
            submitted_at        INTEGER NOT NULL,
            decided_at          INTEGER
        );
CREATE INDEX idx_mloc_user_env_status
            ON ml_opportunity_candidates(user_id, resolved_env, status);
CREATE TABLE ml_capital_auction_decisions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            auction_id                  TEXT NOT NULL UNIQUE,
            candidates_json             TEXT NOT NULL,
            accepted_ids_json           TEXT NOT NULL,
            deferred_ids_json           TEXT NOT NULL,
            rejected_ids_json           TEXT NOT NULL,
            total_capital_available     REAL NOT NULL,
            total_capital_used          REAL NOT NULL,
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlcad_user_env_ts
            ON ml_capital_auction_decisions(user_id, resolved_env, ts);
CREATE TABLE ml_voi_evaluations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                     TEXT NOT NULL UNIQUE,
            expected_confirmation_value     REAL NOT NULL,
            funding_cost_bps                REAL NOT NULL,
            opportunity_cost                REAL NOT NULL,
            slippage_cost_bps               REAL NOT NULL,
            total_cost                      REAL NOT NULL,
            voi                             REAL NOT NULL,
            recommendation                  TEXT NOT NULL CHECK(recommendation IN
                                            ('WAIT','ACT_NOW')),
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlve_user_env_rec_ts
            ON ml_voi_evaluations(user_id, resolved_env, recommendation, ts);
CREATE TABLE ml_dro_uncertainty_sets (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            set_id                  TEXT NOT NULL UNIQUE,
            set_name                TEXT NOT NULL,
            distribution_configs_json TEXT NOT NULL,
            num_distributions       INTEGER NOT NULL,
            last_updated            INTEGER NOT NULL
        );
CREATE INDEX idx_mldus_user_env
            ON ml_dro_uncertainty_sets(user_id, resolved_env);
CREATE TABLE ml_dro_optimizations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            optimization_id             TEXT NOT NULL UNIQUE,
            set_id                      TEXT NOT NULL,
            candidate_params_json       TEXT NOT NULL,
            worst_case_score            REAL NOT NULL,
            average_score               REAL NOT NULL,
            robustness_premium          REAL NOT NULL,
            recommended_params_json     TEXT NOT NULL,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mldo_user_env_ts
            ON ml_dro_optimizations(user_id, resolved_env, ts);
CREATE TABLE ml_condition_components (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            condition_id            TEXT NOT NULL UNIQUE,
            name                    TEXT NOT NULL,
            atomic_features_json    TEXT NOT NULL,
            known_outcomes_json     TEXT NOT NULL,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlcc_user_env
            ON ml_condition_components(user_id, resolved_env);
CREATE TABLE ml_compositional_predictions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            prediction_id               TEXT NOT NULL UNIQUE,
            components_used_json        TEXT NOT NULL,
            interaction_rule            TEXT NOT NULL CHECK(interaction_rule IN
                                        ('additive','multiplicative','min','max')),
            interaction_score           REAL NOT NULL,
            predicted_outcome_json      TEXT NOT NULL,
            confidence                  REAL NOT NULL,
            actual_outcome_json         TEXT,
            validated                   INTEGER NOT NULL DEFAULT 0 CHECK(validated IN (0,1)),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlcp_user_env_ts
            ON ml_compositional_predictions(user_id, resolved_env, ts);
CREATE TABLE ml_strategic_mandates (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mandate_id          TEXT NOT NULL UNIQUE,
            level               TEXT NOT NULL CHECK(level IN
                                ('strategic','tactical','execution')),
            constraint_type     TEXT NOT NULL CHECK(constraint_type IN
                                ('max_exposure','asset_block','regime_block',
                                 'direction_limit','exposure_cap')),
            parameters_json     TEXT NOT NULL,
            valid_from          INTEGER NOT NULL,
            valid_until         INTEGER NOT NULL,
            status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                ('ACTIVE','EXPIRED')),
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlsm83_user_env_level_status
            ON ml_strategic_mandates(user_id, resolved_env, level, status);
CREATE TABLE ml_hierarchical_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id             TEXT NOT NULL UNIQUE,
            level                   TEXT NOT NULL CHECK(level IN
                                    ('strategic','tactical','execution')),
            candidate_action_json   TEXT NOT NULL,
            mandates_checked_json   TEXT NOT NULL,
            violations_json         TEXT,
            decision                TEXT NOT NULL CHECK(decision IN
                                    ('APPROVED','REJECTED_BY_HIGHER_LEVEL','MODIFIED')),
            reasoning               TEXT,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlhd_user_env_level_decision
            ON ml_hierarchical_decisions(user_id, resolved_env, level, decision);
CREATE TABLE ml_agent_models (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            agent_id                    TEXT NOT NULL UNIQUE,
            agent_type                  TEXT NOT NULL CHECK(agent_type IN
                                        ('market_maker','liquidation_engine','whale',
                                         'arb_bot','retail')),
            objective_function_json     TEXT NOT NULL,
            decision_parameters_json    TEXT NOT NULL,
            last_updated                INTEGER NOT NULL
        );
CREATE INDEX idx_mlam_user_env_type
            ON ml_agent_models(user_id, resolved_env, agent_type);
CREATE TABLE ml_game_predictions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            prediction_id               TEXT NOT NULL UNIQUE,
            agent_id                    TEXT NOT NULL,
            scenario_json               TEXT NOT NULL,
            predicted_action            TEXT NOT NULL CHECK(predicted_action IN
                                        ('widen_spread','withdraw_liquidity','execute_market',
                                         'accumulate','distribute','no_action')),
            confidence                  REAL NOT NULL,
            expected_impact_bps         REAL NOT NULL,
            time_horizon_seconds        INTEGER NOT NULL,
            actual_action               TEXT,
            actual_impact_bps           REAL,
            validated                   INTEGER NOT NULL DEFAULT 0 CHECK(validated IN (0,1)),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlgp_user_env_agent_ts
            ON ml_game_predictions(user_id, resolved_env, agent_id, ts);
CREATE TABLE ml_compute_budgets (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_type       TEXT NOT NULL CHECK(decision_type IN
                                ('scalp','intraday','swing','emergency_exit')),
            deadline_ms         INTEGER NOT NULL,
            compute_budget_ms   INTEGER NOT NULL,
            safety_priority     TEXT NOT NULL CHECK(safety_priority IN
                                ('low','normal','high','critical')),
            last_updated        INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, decision_type)
        );
CREATE INDEX idx_mlcb_user_env_type
            ON ml_compute_budgets(user_id, resolved_env, decision_type);
CREATE TABLE ml_inference_decisions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            inference_id            TEXT NOT NULL UNIQUE,
            decision_type           TEXT NOT NULL CHECK(decision_type IN
                                    ('scalp','intraday','swing','emergency_exit')),
            time_remaining_ms       INTEGER NOT NULL,
            estimated_cost_ms       INTEGER NOT NULL,
            chosen_mode             TEXT NOT NULL CHECK(chosen_mode IN
                                    ('full_stack','reduced_stack','emergency_safety')),
            early_exit_triggered    INTEGER NOT NULL DEFAULT 0 CHECK(early_exit_triggered IN (0,1)),
            reasoning               TEXT,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlid_user_env_mode_ts
            ON ml_inference_decisions(user_id, resolved_env, chosen_mode, ts);
CREATE TABLE ml_capacity_observations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            strategy_id                 TEXT NOT NULL,
            regime                      TEXT NOT NULL,
            asset                       TEXT NOT NULL,
            deployed_capital            REAL NOT NULL,
            observed_pnl                REAL NOT NULL,
            observed_slippage_bps       REAL NOT NULL,
            observed_impact_bps         REAL NOT NULL,
            marginal_alpha              REAL,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlco_user_env_strat_regime_asset
            ON ml_capacity_observations(user_id, resolved_env, strategy_id, regime, asset);
CREATE TABLE ml_capacity_ceilings (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            strategy_id                     TEXT NOT NULL,
            regime                          TEXT NOT NULL,
            asset                           TEXT NOT NULL,
            soft_cap_capital                REAL NOT NULL,
            hard_cap_capital                REAL NOT NULL,
            diminishing_returns_inflection  REAL NOT NULL,
            last_validated                  INTEGER NOT NULL,
            status                          TEXT NOT NULL CHECK(status IN
                                            ('VALID','STALE','EXCEEDED')),
            UNIQUE(user_id, resolved_env, strategy_id, regime, asset)
        );
CREATE INDEX idx_mlcc86_user_env_status
            ON ml_capacity_ceilings(user_id, resolved_env, status);
CREATE TABLE ml_venue_risk_scores (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            venue_id                    TEXT NOT NULL,
            counterparty_risk_score     REAL NOT NULL,
            operational_trust_score     REAL NOT NULL,
            factor_scores_json          TEXT NOT NULL,
            capital_limit_pct           REAL NOT NULL,
            status                      TEXT NOT NULL CHECK(status IN
                                        ('HEALTHY','DEGRADED','RESTRICTED','MIGRATE')),
            last_evaluated              INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, venue_id)
        );
CREATE INDEX idx_mlvrs_user_env_status
            ON ml_venue_risk_scores(user_id, resolved_env, status);
CREATE TABLE ml_venue_incidents (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            venue_id        TEXT NOT NULL,
            incident_type   TEXT NOT NULL CHECK(incident_type IN
                            ('withdrawal_freeze','insolvency','insurance_fund_weakness',
                             'regulatory_freeze','api_instability','operational_failure')),
            severity        TEXT NOT NULL CHECK(severity IN ('low','med','high','critical')),
            details_json    TEXT,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlvi_user_env_venue_ts
            ON ml_venue_incidents(user_id, resolved_env, venue_id, ts);
CREATE TABLE ml_account_stress_simulations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            simulation_id               TEXT NOT NULL UNIQUE,
            portfolio_snapshot_json     TEXT NOT NULL,
            path_type                   TEXT NOT NULL CHECK(path_type IN
                                        ('trend_adverse','whipsaw','spike_retrace',
                                         'funding_shock','volatility_expansion',
                                         'correlation_breakdown')),
            trajectory_steps_json       TEXT NOT NULL,
            distance_to_liquidation     REAL NOT NULL,
            peak_margin_used_pct        REAL NOT NULL,
            liquidation_triggered       INTEGER NOT NULL CHECK(liquidation_triggered IN (0,1)),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlass_user_env_path_ts
            ON ml_account_stress_simulations(user_id, resolved_env, path_type, ts);
CREATE TABLE ml_liquidation_warnings (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            warning_id                  TEXT NOT NULL UNIQUE,
            portfolio_snapshot_json     TEXT NOT NULL,
            closest_path                TEXT NOT NULL,
            distance                    REAL NOT NULL,
            recommended_action          TEXT NOT NULL CHECK(recommended_action IN
                                        ('CONTINUE','REDUCE_SIZE','DEFENSIVE',
                                         'CLOSE_PARTIAL','EMERGENCY_EXIT')),
            severity                    TEXT NOT NULL CHECK(severity IN
                                        ('info','warn','critical')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mllw_user_env_severity_ts
            ON ml_liquidation_warnings(user_id, resolved_env, severity, ts);
CREATE TABLE ml_model_distillation_pairs (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pair_id                 TEXT NOT NULL UNIQUE,
            teacher_model_id        TEXT NOT NULL,
            student_model_id        TEXT NOT NULL,
            regime_scope            TEXT NOT NULL,
            divergence_threshold    REAL NOT NULL,
            status                  TEXT NOT NULL DEFAULT 'HEALTHY' CHECK(status IN
                                    ('HEALTHY','DRIFTING','FALLBACK_ACTIVE')),
            last_validated          INTEGER NOT NULL
        );
CREATE INDEX idx_mlmdp_user_env_status
            ON ml_model_distillation_pairs(user_id, resolved_env, status);
CREATE TABLE ml_distillation_observations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id      TEXT NOT NULL UNIQUE,
            pair_id             TEXT NOT NULL,
            decision_context    TEXT,
            teacher_output_json TEXT NOT NULL,
            student_output_json TEXT NOT NULL,
            divergence          REAL NOT NULL,
            fallback_triggered  INTEGER NOT NULL DEFAULT 0 CHECK(fallback_triggered IN (0,1)),
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mldo89_user_env_pair_ts
            ON ml_distillation_observations(user_id, resolved_env, pair_id, ts);
CREATE TABLE ml_metric_registry (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            metric_id       TEXT NOT NULL UNIQUE,
            name            TEXT NOT NULL,
            formula_hash    TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK(kind IN ('primary','secondary','holdout')),
            model_visible   INTEGER NOT NULL DEFAULT 1 CHECK(model_visible IN (0,1)),
            status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                            ('ACTIVE','RETIRED','ROTATED')),
            active_from     INTEGER NOT NULL,
            retired_at      INTEGER
        );
CREATE INDEX idx_mlmr_user_env_kind_status
            ON ml_metric_registry(user_id, resolved_env, kind, status);
CREATE TABLE ml_metric_rotations (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            rotation_id          TEXT NOT NULL UNIQUE,
            retired_metric_ids   TEXT NOT NULL,
            new_metric_ids       TEXT NOT NULL,
            rotation_reason      TEXT NOT NULL,
            ts                   INTEGER NOT NULL
        );
CREATE INDEX idx_mlmrot_user_env_ts
            ON ml_metric_rotations(user_id, resolved_env, ts);
CREATE TABLE ml_topology_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id              TEXT NOT NULL UNIQUE,
            feature_window_size      INTEGER NOT NULL,
            betti_0                  INTEGER NOT NULL,
            betti_1                  INTEGER NOT NULL,
            persistence_diagram_json TEXT,
            regime_label             TEXT,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlts_user_env_ts
            ON ml_topology_snapshots(user_id, resolved_env, ts);
CREATE TABLE ml_topology_transitions (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id      TEXT NOT NULL UNIQUE,
            from_snapshot_id   TEXT NOT NULL,
            to_snapshot_id     TEXT NOT NULL,
            betti_delta_json   TEXT NOT NULL,
            transition_type    TEXT NOT NULL CHECK(transition_type IN
                               ('STABLE','REGIME_SHIFT','CORRELATION_BREAKDOWN')),
            severity           REAL NOT NULL,
            ts                 INTEGER NOT NULL
        );
CREATE INDEX idx_mltt_user_env_ts
            ON ml_topology_transitions(user_id, resolved_env, ts);
CREATE TABLE ml_uncertainty_nodes (
            id                           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                      INTEGER NOT NULL,
            resolved_env                 TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            node_id                      TEXT NOT NULL UNIQUE,
            pipeline_id                  TEXT NOT NULL,
            kind                         TEXT NOT NULL CHECK(kind IN
                                         ('data','detector','aggregator','decision')),
            point_estimate               REAL NOT NULL,
            variance                     REAL NOT NULL CHECK(variance >= 0),
            contributing_node_ids_json   TEXT,
            ts                           INTEGER NOT NULL
        );
CREATE INDEX idx_mlun_user_env_pipe
            ON ml_uncertainty_nodes(user_id, resolved_env, pipeline_id);
CREATE TABLE ml_uncertainty_pipelines (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            pipeline_id                 TEXT NOT NULL UNIQUE,
            name                        TEXT NOT NULL,
            decision_node_id            TEXT,
            total_propagated_variance   REAL,
            status                      TEXT NOT NULL DEFAULT 'HEALTHY' CHECK(status IN
                                        ('HEALTHY','DEGRADED','UNRELIABLE')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlup_user_env_status
            ON ml_uncertainty_pipelines(user_id, resolved_env, status);
CREATE TABLE ml_regime_sentences (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            sentence_id     TEXT NOT NULL UNIQUE,
            regime_label    TEXT NOT NULL,
            primitives_json TEXT NOT NULL,
            source_context  TEXT,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlrs_user_env_ts
            ON ml_regime_sentences(user_id, resolved_env, ts);
CREATE INDEX idx_mlrs_user_env_label
            ON ml_regime_sentences(user_id, resolved_env, regime_label);
CREATE TABLE ml_regime_overlaps (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            resolved_env     TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            overlap_id       TEXT NOT NULL UNIQUE,
            sentence_a_id    TEXT NOT NULL,
            sentence_b_id    TEXT NOT NULL,
            overlap_count    INTEGER NOT NULL CHECK(overlap_count BETWEEN 0 AND 5),
            overlap_ratio    REAL NOT NULL,
            ts               INTEGER NOT NULL
        );
CREATE INDEX idx_mlro_user_env_ts
            ON ml_regime_overlaps(user_id, resolved_env, ts);
CREATE TABLE ml_complexity_registry (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            feature_id        TEXT NOT NULL UNIQUE,
            complexity_units  REAL NOT NULL CHECK(complexity_units >= 0),
            information_gain  REAL,
            mdl_score         REAL,
            status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                              ('ACTIVE','EVALUATING','PRUNED')),
            last_evaluated    INTEGER,
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mlcr_user_env_status
            ON ml_complexity_registry(user_id, resolved_env, status);
CREATE TABLE ml_complexity_evaluations (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id          TEXT NOT NULL UNIQUE,
            feature_id             TEXT NOT NULL,
            marginal_ig            REAL NOT NULL,
            marginal_complexity    REAL NOT NULL CHECK(marginal_complexity >= 0),
            mdl_delta              REAL,
            decision               TEXT NOT NULL CHECK(decision IN ('KEEP','WATCH','PRUNE')),
            reason                 TEXT,
            ts                     INTEGER NOT NULL
        );
CREATE INDEX idx_mlce_user_env_feat_ts
            ON ml_complexity_evaluations(user_id, resolved_env, feature_id, ts);
CREATE TABLE ml_curiosity_setups (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_id            TEXT NOT NULL UNIQUE,
            hypothesis          TEXT NOT NULL,
            stage               TEXT NOT NULL DEFAULT 'EXPLORE' CHECK(stage IN
                                ('EXPLORE','OBSERVE','VALIDATE','GRADUATED','RETIRED')),
            allocated_capital   REAL NOT NULL CHECK(allocated_capital >= 0),
            max_capital_cap     REAL NOT NULL CHECK(max_capital_cap >= 0),
            observations_count  INTEGER NOT NULL DEFAULT 0,
            pnl_cumulative      REAL NOT NULL DEFAULT 0,
            ts_created          INTEGER NOT NULL,
            ts_last_updated     INTEGER NOT NULL
        );
CREATE INDEX idx_mlcs_user_env_stage
            ON ml_curiosity_setups(user_id, resolved_env, stage);
CREATE TABLE ml_curiosity_trades (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            resolved_env  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trade_id      TEXT NOT NULL UNIQUE,
            setup_id      TEXT NOT NULL,
            source        TEXT NOT NULL CHECK(source IN ('exploitation','exploration')),
            capital_used  REAL NOT NULL CHECK(capital_used >= 0),
            pnl           REAL NOT NULL,
            ts            INTEGER NOT NULL
        );
CREATE INDEX idx_mlct_user_env_source_ts
            ON ml_curiosity_trades(user_id, resolved_env, source, ts);
CREATE INDEX idx_mlct_setup_ts
            ON ml_curiosity_trades(setup_id, ts);
CREATE TABLE ml_data_fingerprints (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            fingerprint_id             TEXT NOT NULL UNIQUE,
            marginal_distributions_json TEXT NOT NULL,
            transition_matrix_json     TEXT NOT NULL,
            sample_count               INTEGER NOT NULL CHECK(sample_count >= 0),
            ts                         INTEGER NOT NULL
        );
CREATE INDEX idx_mldf_user_env_ts
            ON ml_data_fingerprints(user_id, resolved_env, ts);
CREATE TABLE ml_synthetic_scenarios (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            scenario_id              TEXT NOT NULL UNIQUE,
            regime_sequence_json     TEXT NOT NULL,
            scenario_type            TEXT NOT NULL CHECK(scenario_type IN
                                     ('trend_to_panic','range_to_squeeze',
                                      'macro_shock','venue_fragmentation','custom')),
            source_fingerprint_id    TEXT,
            plausibility_score       REAL,
            is_synthetic             INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
            flagged_for_review       INTEGER NOT NULL DEFAULT 0 CHECK(flagged_for_review IN (0,1)),
            flag_reason              TEXT,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlss_user_env_type
            ON ml_synthetic_scenarios(user_id, resolved_env, scenario_type);
CREATE TABLE ml_knowledge_items (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            item_id              TEXT NOT NULL UNIQUE,
            kind                 TEXT NOT NULL CHECK(kind IN
                                 ('heuristic','threshold','episodic_analogy',
                                  'prior','causal_relation','execution_rule')),
            content_json         TEXT NOT NULL,
            freshness_score      REAL NOT NULL CHECK(freshness_score >= 0 AND freshness_score <= 1),
            status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                 ('ACTIVE','WEAKENED','QUARANTINED','RETIRED','REVIVED')),
            ts_created           INTEGER NOT NULL,
            ts_last_relevance    INTEGER NOT NULL,
            ts_status_changed    INTEGER NOT NULL
        );
CREATE INDEX idx_mlki_user_env_status
            ON ml_knowledge_items(user_id, resolved_env, status);
CREATE INDEX idx_mlki_user_env_kind
            ON ml_knowledge_items(user_id, resolved_env, kind);
CREATE TABLE ml_forgetting_decisions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id     TEXT NOT NULL UNIQUE,
            item_id         TEXT NOT NULL,
            action          TEXT NOT NULL CHECK(action IN
                            ('WEAKEN','QUARANTINE','RETIRE','REVIVE')),
            prior_status    TEXT NOT NULL,
            new_status      TEXT NOT NULL,
            reason          TEXT NOT NULL,
            evidence_json   TEXT,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlfd_user_env_item_ts
            ON ml_forgetting_decisions(user_id, resolved_env, item_id, ts);
CREATE TABLE ml_dependency_nodes (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            node_id              TEXT NOT NULL UNIQUE,
            node_type            TEXT NOT NULL CHECK(node_type IN
                                 ('feed','detector','model','execution_path',
                                  'safety_module','monitoring')),
            name                 TEXT NOT NULL,
            owner                TEXT NOT NULL,
            blast_radius_score   REAL NOT NULL DEFAULT 0 CHECK(blast_radius_score >= 0),
            criticality          TEXT NOT NULL CHECK(criticality IN
                                 ('critical','important','optional')),
            is_active            INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts                   INTEGER NOT NULL
        );
CREATE INDEX idx_mldn_user_env_type
            ON ml_dependency_nodes(user_id, resolved_env, node_type);
CREATE TABLE ml_dependency_edges (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            edge_id         TEXT NOT NULL UNIQUE,
            from_node_id    TEXT NOT NULL,
            to_node_id      TEXT NOT NULL,
            edge_type       TEXT NOT NULL CHECK(edge_type IN
                            ('depends_on','feeds','monitors')),
            strength        REAL NOT NULL CHECK(strength >= 0 AND strength <= 1),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlde_user_env_from
            ON ml_dependency_edges(user_id, resolved_env, from_node_id);
CREATE INDEX idx_mlde_user_env_to
            ON ml_dependency_edges(user_id, resolved_env, to_node_id);
CREATE TABLE ml_observability_queries (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            query_id                TEXT NOT NULL UNIQUE,
            observation_type        TEXT NOT NULL CHECK(observation_type IN
                                    ('deep_book','venue_confirmation',
                                     'options_refresh','funding_oi_refresh',
                                     'sentiment_refresh')),
            decision                TEXT NOT NULL CHECK(decision IN
                                    ('query_now','wait','skip')),
            expected_ig             REAL NOT NULL CHECK(expected_ig >= 0),
            cost_estimate           REAL NOT NULL CHECK(cost_estimate >= 0),
            utility_ratio           REAL NOT NULL,
            deadline_remaining_ms   INTEGER NOT NULL,
            reason                  TEXT,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mloq_user_env_type_ts
            ON ml_observability_queries(user_id, resolved_env, observation_type, ts);
CREATE TABLE ml_observability_outcomes (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            outcome_id        TEXT NOT NULL UNIQUE,
            query_id          TEXT NOT NULL,
            actual_ig         REAL NOT NULL,
            actual_cost       REAL NOT NULL CHECK(actual_cost >= 0),
            verdict_changed   INTEGER NOT NULL CHECK(verdict_changed IN (0,1)),
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mloo_user_env_query
            ON ml_observability_outcomes(user_id, resolved_env, query_id);
CREATE TABLE ml_narrative_threads (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            thread_id             TEXT NOT NULL UNIQUE,
            why_moving            TEXT,
            who_selling           TEXT,
            who_buying            TEXT,
            trapped_side          TEXT,
            expected_resolution   TEXT,
            coherence_score       REAL NOT NULL DEFAULT 0 CHECK(coherence_score >= 0 AND coherence_score <= 1),
            status                TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN
                                  ('COHERENT','INCOHERENT','PENDING')),
            ts                    INTEGER NOT NULL
        );
CREATE INDEX idx_mlnt_user_env_status
            ON ml_narrative_threads(user_id, resolved_env, status);
CREATE TABLE ml_narrative_arc_links (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            link_id         TEXT NOT NULL UNIQUE,
            thread_id       TEXT NOT NULL,
            signal_id       TEXT NOT NULL,
            supports        INTEGER NOT NULL CHECK(supports IN (0,1)),
            contribution    REAL,
            reason          TEXT,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlnl_user_env_thread
            ON ml_narrative_arc_links(user_id, resolved_env, thread_id);
CREATE TABLE ml_socratic_sessions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            session_id          TEXT NOT NULL UNIQUE,
            trigger             TEXT NOT NULL CHECK(trigger IN
                                ('periodic_interval','post_good_performance','manual')),
            beliefs_examined    INTEGER NOT NULL DEFAULT 0,
            beliefs_falsified   INTEGER NOT NULL DEFAULT 0,
            status              TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN
                                ('OPEN','CLOSED')),
            ts_started          INTEGER NOT NULL,
            ts_closed           INTEGER
        );
CREATE INDEX idx_mlss_user_env_status_ts
            ON ml_socratic_sessions(user_id, resolved_env, status, ts_started);
CREATE TABLE ml_socratic_challenges (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            challenge_id            TEXT NOT NULL UNIQUE,
            session_id              TEXT NOT NULL,
            belief_id               TEXT NOT NULL,
            premise                 TEXT NOT NULL,
            counterfactual          TEXT NOT NULL,
            falsification_result    TEXT NOT NULL CHECK(falsification_result IN
                                    ('CONFIRMED','QUESTIONED','REFUTED','INCONCLUSIVE')),
            evidence_score          REAL,
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlsc_user_env_session
            ON ml_socratic_challenges(user_id, resolved_env, session_id);
CREATE TABLE ml_analogy_templates (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            template_id             TEXT NOT NULL UNIQUE,
            source_domain           TEXT NOT NULL CHECK(source_domain IN
                                    ('ecology','epidemiology','hydrodynamics',
                                     'thermodynamics','physics','network_theory','biology')),
            structural_pattern_json TEXT NOT NULL,
            market_application      TEXT NOT NULL,
            status                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                    ('ACTIVE','RETIRED')),
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlat_user_env_domain_status
            ON ml_analogy_templates(user_id, resolved_env, source_domain, status);
CREATE TABLE ml_analogy_matches (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            match_id                 TEXT NOT NULL UNIQUE,
            template_id              TEXT NOT NULL,
            market_situation_id      TEXT NOT NULL,
            structural_similarity    REAL NOT NULL CHECK(structural_similarity >= 0 AND structural_similarity <= 1),
            predicted_outcome        TEXT NOT NULL,
            actual_outcome           TEXT,
            accuracy                 REAL,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlam_user_env_template_ts
            ON ml_analogy_matches(user_id, resolved_env, template_id, ts);
CREATE TABLE ml_wisdom_heuristics (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            heuristic_id    TEXT NOT NULL UNIQUE,
            rule_text       TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK(kind IN
                            ('timing','regime','cognition','risk')),
            priority        INTEGER NOT NULL DEFAULT 0,
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlwh_user_env_kind_active
            ON ml_wisdom_heuristics(user_id, resolved_env, kind, is_active);
CREATE TABLE ml_wisdom_overrides (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            override_id        TEXT NOT NULL UNIQUE,
            heuristic_id       TEXT,
            decision_context   TEXT NOT NULL,
            complexity_score   REAL NOT NULL CHECK(complexity_score >= 0),
            signal_quality     REAL NOT NULL CHECK(signal_quality >= 0 AND signal_quality <= 1),
            ratio              REAL NOT NULL,
            override_action    TEXT NOT NULL CHECK(override_action IN
                               ('SIMPLIFY','ABSTAIN','PROCEED_NORMAL')),
            ts                 INTEGER NOT NULL
        );
CREATE INDEX idx_mlwo_user_env_action_ts
            ON ml_wisdom_overrides(user_id, resolved_env, override_action, ts);
CREATE TABLE ml_integrity_constraints (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            constraint_id   TEXT NOT NULL UNIQUE,
            kind            TEXT NOT NULL CHECK(kind IN
                            ('venue_health','ecosystem_impact',
                             'peer_predation','liquidity_provision')),
            description     TEXT NOT NULL,
            severity        TEXT NOT NULL CHECK(severity IN ('advisory','strict')),
            is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlic_user_env_kind_active
            ON ml_integrity_constraints(user_id, resolved_env, kind, is_active);
CREATE TABLE ml_integrity_violations (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            resolved_env     TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id     TEXT NOT NULL UNIQUE,
            constraint_id    TEXT,
            action_context   TEXT NOT NULL,
            severity_score   REAL NOT NULL CHECK(severity_score >= 0 AND severity_score <= 1),
            decision         TEXT NOT NULL CHECK(decision IN
                             ('BLOCK','REDUCE_SIZE','WARN','ACCEPT')),
            reason           TEXT,
            ts               INTEGER NOT NULL
        );
CREATE INDEX idx_mliv_user_env_decision_ts
            ON ml_integrity_violations(user_id, resolved_env, decision, ts);
CREATE TABLE ml_latent_states (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            state_id                 TEXT NOT NULL UNIQUE,
            kind                     TEXT NOT NULL CHECK(kind IN
                                     ('inventory_pressure','liquidity_withdrawal',
                                      'crowd_fragility','squeeze_pressure',
                                      'regime_transition','forced_flow')),
            belief_value             REAL NOT NULL CHECK(belief_value >= 0 AND belief_value <= 1),
            confidence               REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            inference_tier           TEXT NOT NULL CHECK(inference_tier IN
                                     ('direct_observation','inference',
                                      'weak_hypothesis','strong_hypothesis')),
            supporting_sources_json  TEXT,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlls_user_env_kind_ts
            ON ml_latent_states(user_id, resolved_env, kind, ts);
CREATE TABLE ml_belief_updates (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            update_id         TEXT NOT NULL UNIQUE,
            state_id          TEXT NOT NULL,
            prior_belief      REAL NOT NULL CHECK(prior_belief >= 0 AND prior_belief <= 1),
            posterior_belief  REAL NOT NULL CHECK(posterior_belief >= 0 AND posterior_belief <= 1),
            likelihood        REAL NOT NULL CHECK(likelihood >= 0 AND likelihood <= 1),
            evidence_json     TEXT,
            delta             REAL NOT NULL,
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mlbu_user_env_state_ts
            ON ml_belief_updates(user_id, resolved_env, state_id, ts);
CREATE TABLE ml_competence_cells (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            cell_id             TEXT NOT NULL UNIQUE,
            dimensions_json     TEXT NOT NULL,
            validity_score      REAL NOT NULL CHECK(validity_score >= 0 AND validity_score <= 1),
            sample_count        INTEGER NOT NULL CHECK(sample_count >= 0),
            win_rate            REAL,
            action_permission   TEXT NOT NULL CHECK(action_permission IN
                                ('allowed','reduced_size','shadow_only','observer_only')),
            last_updated        INTEGER NOT NULL,
            ts_created          INTEGER NOT NULL
        );
CREATE INDEX idx_mlcc_user_env_permission
            ON ml_competence_cells(user_id, resolved_env, action_permission);
CREATE TABLE ml_competence_decisions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id         TEXT NOT NULL UNIQUE,
            cell_id             TEXT,
            decision_context    TEXT NOT NULL,
            action_permission   TEXT NOT NULL CHECK(action_permission IN
                                ('allowed','reduced_size','shadow_only','observer_only')),
            reason              TEXT NOT NULL,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlcd_user_env_permission_ts
            ON ml_competence_decisions(user_id, resolved_env, action_permission, ts);
CREATE TABLE ml_invariance_tests (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            test_id             TEXT NOT NULL UNIQUE,
            model_id            TEXT NOT NULL,
            perturbation_kind   TEXT NOT NULL CHECK(perturbation_kind IN
                                ('scale','timestamp_jitter','resampling',
                                 'feed_perturbation','representation')),
            original_verdict    TEXT NOT NULL,
            perturbed_verdict   TEXT NOT NULL,
            verdict_stable      INTEGER NOT NULL CHECK(verdict_stable IN (0,1)),
            magnitude           REAL,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlit_user_env_model_kind
            ON ml_invariance_tests(user_id, resolved_env, model_id, perturbation_kind);
CREATE TABLE ml_robustness_scores (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            score_id        TEXT NOT NULL UNIQUE,
            model_id        TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK(kind IN
                            ('scale','timestamp_jitter','resampling',
                             'feed_perturbation','representation','aggregate')),
            score           REAL NOT NULL CHECK(score >= 0 AND score <= 1),
            sample_count    INTEGER NOT NULL CHECK(sample_count >= 0),
            status          TEXT NOT NULL CHECK(status IN
                            ('ROBUST','FRAGILE','INSUFFICIENT')),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlrs_user_env_model_status_ts
            ON ml_robustness_scores(user_id, resolved_env, model_id, status, ts);
CREATE TABLE ml_commitment_setups (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            setup_id              TEXT NOT NULL UNIQUE,
            target_total_size     REAL NOT NULL CHECK(target_total_size >= 0),
            current_filled_size   REAL NOT NULL DEFAULT 0 CHECK(current_filled_size >= 0),
            status                TEXT NOT NULL DEFAULT 'probing' CHECK(status IN
                                  ('probing','confirming','full','aborted','completed')),
            thesis_id             TEXT,
            ts_created            INTEGER NOT NULL,
            ts_last_updated       INTEGER NOT NULL
        );
CREATE INDEX idx_mlcs108_user_env_status
            ON ml_commitment_setups(user_id, resolved_env, status);
CREATE TABLE ml_commitment_tranches (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                   INTEGER NOT NULL,
            resolved_env              TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            tranche_id                TEXT NOT NULL UNIQUE,
            setup_id                  TEXT NOT NULL,
            kind                      TEXT NOT NULL CHECK(kind IN
                                      ('exploratory','conviction',
                                       'confirmation_add','defensive_reduce')),
            size                      REAL NOT NULL,
            market_response_score     REAL,
            decision_after            TEXT CHECK(decision_after IS NULL OR decision_after IN
                                      ('expand','hold','abort','exit')),
            ts                        INTEGER NOT NULL
        );
CREATE INDEX idx_mlct108_user_env_setup_ts
            ON ml_commitment_tranches(user_id, resolved_env, setup_id, ts);
CREATE TABLE ml_oracle_decisions (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            oracle_id                       TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            actual_action_json              TEXT NOT NULL,
            optimal_feasible_action_json    TEXT NOT NULL,
            total_regret                    REAL NOT NULL CHECK(total_regret >= 0),
            feasibility_constraints_json    TEXT NOT NULL,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlod_user_env_ts
            ON ml_oracle_decisions(user_id, resolved_env, ts);
CREATE INDEX idx_mlod_decision
            ON ml_oracle_decisions(decision_id);
CREATE TABLE ml_regret_components (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            component_id      TEXT NOT NULL UNIQUE,
            oracle_id         TEXT NOT NULL,
            regret_kind       TEXT NOT NULL CHECK(regret_kind IN
                              ('signal','timing','sizing','execution','abstention')),
            component_value   REAL NOT NULL CHECK(component_value >= 0),
            notes             TEXT,
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mlrc_user_env_oracle_kind
            ON ml_regret_components(user_id, resolved_env, oracle_id, regret_kind);
CREATE TABLE ml_module_priorities (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            priority_id         TEXT NOT NULL UNIQUE,
            module_id           TEXT NOT NULL,
            kind                TEXT NOT NULL CHECK(kind IN
                                ('safety','veto','normal')),
            constant_priority   INTEGER NOT NULL,
            is_active           INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            last_invoked        INTEGER,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlmp_user_env_kind_active
            ON ml_module_priorities(user_id, resolved_env, kind, is_active);
CREATE TABLE ml_reasoning_paths (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            path_id                  TEXT NOT NULL UNIQUE,
            decision_context_json    TEXT NOT NULL,
            modules_included_json    TEXT NOT NULL,
            modules_skipped_json     TEXT NOT NULL,
            cognitive_budget_used    REAL NOT NULL CHECK(cognitive_budget_used >= 0),
            justification            TEXT NOT NULL,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlrp_user_env_ts
            ON ml_reasoning_paths(user_id, resolved_env, ts);
CREATE TABLE ml_scenario_trees (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            tree_id                  TEXT NOT NULL UNIQUE,
            decision_id              TEXT NOT NULL,
            dominant_branch          TEXT NOT NULL CHECK(dominant_branch IN
                                     ('continuation','fakeout','squeeze',
                                      'mean_reversion','macro_interruption')),
            active_branches_count    INTEGER NOT NULL CHECK(active_branches_count >= 0),
            weighted_score           REAL NOT NULL,
            adverse_share            REAL NOT NULL CHECK(adverse_share >= 0 AND adverse_share <= 1),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlst_user_env_ts
            ON ml_scenario_trees(user_id, resolved_env, ts);
CREATE TABLE ml_scenario_branches (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            branch_id         TEXT NOT NULL UNIQUE,
            tree_id           TEXT NOT NULL,
            branch_kind       TEXT NOT NULL CHECK(branch_kind IN
                              ('continuation','fakeout','squeeze',
                               'mean_reversion','macro_interruption')),
            probability       REAL NOT NULL CHECK(probability >= 0 AND probability <= 1),
            expected_action   TEXT NOT NULL,
            expected_pnl      REAL NOT NULL,
            is_pruned         INTEGER NOT NULL CHECK(is_pruned IN (0,1)),
            reason            TEXT,
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mlsb_user_env_tree
            ON ml_scenario_branches(user_id, resolved_env, tree_id);
CREATE TABLE ml_hypothesis_registry (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            hypothesis_id                 TEXT NOT NULL UNIQUE,
            kind                          TEXT NOT NULL CHECK(kind IN
                                          ('continuation','distribution',
                                           'short_covering','liquidity_grab',
                                           'macro_override')),
            posterior_score               REAL NOT NULL CHECK(posterior_score >= 0 AND posterior_score <= 1),
            status                        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                          ('ACTIVE','RETIRED','DOMINANT')),
            invalidation_conditions_json  TEXT NOT NULL,
            ts_created                    INTEGER NOT NULL,
            ts_last_updated               INTEGER NOT NULL
        );
CREATE INDEX idx_mlhr_user_env_status
            ON ml_hypothesis_registry(user_id, resolved_env, status);
CREATE TABLE ml_hypothesis_transitions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id            TEXT NOT NULL UNIQUE,
            from_hypothesis_id       TEXT NOT NULL,
            to_hypothesis_id         TEXT NOT NULL,
            evidence_summary         TEXT NOT NULL,
            posterior_from_before    REAL NOT NULL CHECK(posterior_from_before >= 0 AND posterior_from_before <= 1),
            posterior_from_after     REAL NOT NULL CHECK(posterior_from_after >= 0 AND posterior_from_after <= 1),
            posterior_to_before      REAL NOT NULL CHECK(posterior_to_before >= 0 AND posterior_to_before <= 1),
            posterior_to_after       REAL NOT NULL CHECK(posterior_to_after >= 0 AND posterior_to_after <= 1),
            amount_transferred       REAL NOT NULL CHECK(amount_transferred >= 0),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlht_user_env_ts
            ON ml_hypothesis_transitions(user_id, resolved_env, ts);
CREATE TABLE ml_causal_edge_proposals (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            proposal_id          TEXT NOT NULL UNIQUE,
            from_node            TEXT NOT NULL,
            to_node              TEXT NOT NULL,
            proposed_change      TEXT NOT NULL CHECK(proposed_change IN
                                 ('ADD','STRENGTHEN','WEAKEN','INVERT',
                                  'REMOVE','CONTEXTUALIZE')),
            candidate_strength   REAL NOT NULL CHECK(candidate_strength >= 0 AND candidate_strength <= 1),
            evidence_summary     TEXT NOT NULL,
            evidence_count       INTEGER NOT NULL CHECK(evidence_count >= 0),
            status               TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN
                                 ('PROPOSED','SHADOW_VALIDATING','CONFIRMED','REJECTED')),
            human_approved       INTEGER NOT NULL DEFAULT 0 CHECK(human_approved IN (0,1)),
            ts_proposed          INTEGER NOT NULL,
            ts_decided           INTEGER
        );
CREATE INDEX idx_mlcep_user_env_status
            ON ml_causal_edge_proposals(user_id, resolved_env, status);
CREATE TABLE ml_graph_revisions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            revision_id              TEXT NOT NULL UNIQUE,
            version                  INTEGER NOT NULL CHECK(version >= 1),
            applied_proposals_json   TEXT NOT NULL,
            revision_reason          TEXT NOT NULL,
            ts_applied               INTEGER NOT NULL
        );
CREATE INDEX idx_mlgr_user_env_version
            ON ml_graph_revisions(user_id, resolved_env, version);
CREATE TABLE ml_concepts (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            concept_id           TEXT NOT NULL UNIQUE,
            label                TEXT NOT NULL,
            description          TEXT NOT NULL,
            support_count        INTEGER NOT NULL DEFAULT 0 CHECK(support_count >= 0),
            utility_score        REAL NOT NULL DEFAULT 0 CHECK(utility_score >= 0 AND utility_score <= 1),
            confidence           REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN
                                 ('ACTIVE','MERGED','SPLIT','RETIRED')),
            parent_concept_id    TEXT,
            ts_created           INTEGER NOT NULL,
            ts_last_updated      INTEGER NOT NULL
        );
CREATE INDEX idx_mlc_user_env_status_label
            ON ml_concepts(user_id, resolved_env, status, label);
CREATE TABLE ml_concept_observations (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id         TEXT NOT NULL UNIQUE,
            concept_id             TEXT NOT NULL,
            market_state_json      TEXT NOT NULL,
            outcome                TEXT NOT NULL,
            decision_relevance     REAL NOT NULL CHECK(decision_relevance >= 0 AND decision_relevance <= 1),
            ts                     INTEGER NOT NULL
        );
CREATE INDEX idx_mlco_user_env_concept_ts
            ON ml_concept_observations(user_id, resolved_env, concept_id, ts);
CREATE TABLE ml_repair_proposals (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            proposal_id              TEXT NOT NULL UNIQUE,
            issue_kind               TEXT NOT NULL CHECK(issue_kind IN
                                     ('threshold','regime_misclassification',
                                      'sizing','execution_drift',
                                      'feature_redundancy','stale_concepts')),
            remediation_type         TEXT NOT NULL CHECK(remediation_type IN
                                     ('retune','retrain','disable','replace',
                                      'quarantine','shadow_experiment')),
            affected_component_id    TEXT NOT NULL,
            expected_benefit         REAL NOT NULL CHECK(expected_benefit >= 0 AND expected_benefit <= 1),
            expected_risk            REAL NOT NULL CHECK(expected_risk >= 0 AND expected_risk <= 1),
            rank_score               REAL NOT NULL,
            status                   TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN
                                     ('PROPOSED','SHADOW','CANARY','APPLIED','REJECTED')),
            justification            TEXT NOT NULL,
            ts_proposed              INTEGER NOT NULL,
            ts_decided               INTEGER
        );
CREATE INDEX idx_mlrp115_user_env_status
            ON ml_repair_proposals(user_id, resolved_env, status);
CREATE TABLE ml_repair_outcomes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            outcome_id          TEXT NOT NULL UNIQUE,
            proposal_id         TEXT NOT NULL,
            observed_benefit    REAL NOT NULL,
            observed_risk       REAL NOT NULL,
            decision            TEXT NOT NULL CHECK(decision IN
                                ('PROMOTE','REJECT','EXTEND_SHADOW')),
            reason              TEXT,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlro115_user_env_proposal
            ON ml_repair_outcomes(user_id, resolved_env, proposal_id);
CREATE TABLE ml_charter_principles (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            principle_id      TEXT NOT NULL UNIQUE,
            kind              TEXT NOT NULL CHECK(kind IN
                              ('profit','safety','truth','compliance',
                               'integrity','long_term_survivability')),
            priority_rank     INTEGER NOT NULL CHECK(priority_rank >= 1),
            description       TEXT NOT NULL,
            is_active         INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts_created        INTEGER NOT NULL,
            ts_last_updated   INTEGER NOT NULL
        );
CREATE INDEX idx_mlcp116_user_env_rank
            ON ml_charter_principles(user_id, resolved_env, priority_rank);
CREATE TABLE ml_charter_decisions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                 TEXT NOT NULL UNIQUE,
            action_summary              TEXT NOT NULL,
            conflicting_principles_json TEXT NOT NULL,
            charter_status              TEXT NOT NULL CHECK(charter_status IN
                                        ('CONSTITUTIONAL_COMPLIANT',
                                         'CONSTITUTIONALLY_DEGRADED',
                                         'CONSTITUTIONALLY_BLOCKED')),
            utility_score               REAL,
            override_reason             TEXT,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlcd116_user_env_status_ts
            ON ml_charter_decisions(user_id, resolved_env, charter_status, ts);
CREATE TABLE ml_belief_nodes (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            node_id                TEXT NOT NULL UNIQUE,
            belief_id              TEXT NOT NULL,
            kind                   TEXT NOT NULL CHECK(kind IN
                                   ('raw_feed','preprocess','detector_output',
                                    'score_transform','gating_event',
                                    'thesis_node','policy_verdict')),
            source_type            TEXT NOT NULL CHECK(source_type IN
                                   ('direct_observation','derived_inference',
                                    'propagated_hypothesis',
                                    'historical_prior','episodic_analogy')),
            parent_node_ids_json   TEXT NOT NULL,
            content_summary        TEXT NOT NULL,
            ts                     INTEGER NOT NULL
        );
CREATE INDEX idx_mlbn_user_env_belief_ts
            ON ml_belief_nodes(user_id, resolved_env, belief_id, ts);
CREATE TABLE ml_belief_lineages (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            lineage_id          TEXT NOT NULL UNIQUE,
            belief_id           TEXT NOT NULL,
            root_node_id        TEXT NOT NULL,
            terminal_node_id    TEXT NOT NULL,
            decision_id         TEXT NOT NULL,
            node_count          INTEGER NOT NULL CHECK(node_count >= 1),
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlbl_user_env_belief_ts
            ON ml_belief_lineages(user_id, resolved_env, belief_id, ts);
CREATE TABLE ml_belief_regularization_audit (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id                 TEXT NOT NULL UNIQUE,
            belief_id                TEXT NOT NULL,
            prior_value              REAL NOT NULL,
            proposed_value           REAL NOT NULL,
            applied_value            REAL NOT NULL,
            evidence_kind            TEXT NOT NULL CHECK(evidence_kind IN
                                     ('structural_signal','strident_event',
                                      'lucky_streak','unlucky_streak')),
            regularization_factor    REAL NOT NULL CHECK(regularization_factor >= 0 AND regularization_factor <= 1),
            reason                   TEXT,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlbra_user_env_belief_ts
            ON ml_belief_regularization_audit(user_id, resolved_env, belief_id, ts);
CREATE TABLE ml_belief_update_limits (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            limit_id                 TEXT NOT NULL UNIQUE,
            belief_category          TEXT NOT NULL,
            max_delta_per_update     REAL NOT NULL CHECK(max_delta_per_update > 0),
            max_updates_per_window   INTEGER NOT NULL CHECK(max_updates_per_window > 0),
            window_seconds           INTEGER NOT NULL CHECK(window_seconds > 0),
            regime_modifier_json     TEXT,
            ts_created               INTEGER NOT NULL,
            ts_last_updated          INTEGER NOT NULL
        );
CREATE INDEX idx_mlbul_user_env_category
            ON ml_belief_update_limits(user_id, resolved_env, belief_category);
CREATE TABLE ml_premortem_sessions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            session_id              TEXT NOT NULL UNIQUE,
            decision_id             TEXT NOT NULL,
            dominant_failure_mode   TEXT,
            total_failure_modes     INTEGER NOT NULL DEFAULT 0 CHECK(total_failure_modes >= 0),
            max_severity            REAL NOT NULL DEFAULT 0 CHECK(max_severity >= 0 AND max_severity <= 1),
            aggregate_risk_score    REAL NOT NULL DEFAULT 0,
            status                  TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
            ts_started              INTEGER NOT NULL,
            ts_closed               INTEGER
        );
CREATE INDEX idx_mlps_user_env_decision_status
            ON ml_premortem_sessions(user_id, resolved_env, decision_id, status);
CREATE TABLE ml_premortem_failure_modes (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mode_id           TEXT NOT NULL UNIQUE,
            session_id        TEXT NOT NULL,
            failure_kind      TEXT NOT NULL CHECK(failure_kind IN
                              ('thesis_invalidation_rapid','fakeout',
                               'liquidity_vacuum','slippage_blowout',
                               'venue_failure','latency_miss',
                               'macro_interruption','cross_asset_contagion')),
            severity          REAL NOT NULL CHECK(severity >= 0 AND severity <= 1),
            detectability     REAL NOT NULL CHECK(detectability >= 0 AND detectability <= 1),
            recoverability    REAL NOT NULL CHECK(recoverability >= 0 AND recoverability <= 1),
            action_plan       TEXT NOT NULL CHECK(action_plan IN
                              ('reduce','hedge','exit','observer','lock')),
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mlpfm_user_env_session
            ON ml_premortem_failure_modes(user_id, resolved_env, session_id);
CREATE TABLE ml_unknowns (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            unknown_id               TEXT NOT NULL UNIQUE,
            kind                     TEXT NOT NULL CHECK(kind IN
                                     ('unknown_known','known_unknown',
                                      'unresolved_ambiguity',
                                      'fragile_assumption',
                                      'temporary_operational')),
            description              TEXT NOT NULL,
            impact_sizing            REAL NOT NULL CHECK(impact_sizing >= 0 AND impact_sizing <= 1),
            impact_confidence        REAL NOT NULL CHECK(impact_confidence >= 0 AND impact_confidence <= 1),
            impact_regime            REAL NOT NULL CHECK(impact_regime >= 0 AND impact_regime <= 1),
            impact_execution         REAL NOT NULL CHECK(impact_execution >= 0 AND impact_execution <= 1),
            impact_portfolio_risk    REAL NOT NULL CHECK(impact_portfolio_risk >= 0 AND impact_portfolio_risk <= 1),
            debt_score               REAL NOT NULL CHECK(debt_score >= 0 AND debt_score <= 1),
            status                   TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN
                                     ('OPEN','RESOLVED','ACCEPTED')),
            ts_registered            INTEGER NOT NULL,
            ts_resolved              INTEGER
        );
CREATE INDEX idx_mlu_user_env_status_debt
            ON ml_unknowns(user_id, resolved_env, status, debt_score);
CREATE TABLE ml_assumption_debt_audit (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id        TEXT NOT NULL UNIQUE,
            unknown_id      TEXT NOT NULL,
            action_taken    TEXT NOT NULL CHECK(action_taken IN
                            ('size_reduce','wait','active_sensing',
                             'observer','resolve')),
            reason          TEXT NOT NULL,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlada_user_env_unknown_ts
            ON ml_assumption_debt_audit(user_id, resolved_env, unknown_id, ts);
CREATE TABLE ml_coherence_audits (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id              TEXT NOT NULL UNIQUE,
            layers_checked_json   TEXT NOT NULL,
            equilibrium_score     REAL NOT NULL CHECK(equilibrium_score >= 0 AND equilibrium_score <= 1),
            conflicts_detected    INTEGER NOT NULL CHECK(conflicts_detected >= 0),
            recurring_count       INTEGER NOT NULL CHECK(recurring_count >= 0),
            ts                    INTEGER NOT NULL
        );
CREATE INDEX idx_mlca_user_env_ts
            ON ml_coherence_audits(user_id, resolved_env, ts);
CREATE TABLE ml_systemic_contradictions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            contradiction_id        TEXT NOT NULL UNIQUE,
            audit_id                TEXT NOT NULL,
            layer_a                 TEXT NOT NULL CHECK(layer_a IN
                                    ('constitution','utility','regime_grammar',
                                     'concept_library','thesis_graph','policy_layer')),
            layer_b                 TEXT NOT NULL CHECK(layer_b IN
                                    ('constitution','utility','regime_grammar',
                                     'concept_library','thesis_graph','policy_layer')),
            conflict_description    TEXT NOT NULL,
            recurrence_count        INTEGER NOT NULL CHECK(recurrence_count >= 1),
            recommended_action      TEXT NOT NULL CHECK(recommended_action IN
                                    ('review_rule','weaken_concept',
                                     'quarantine_heuristic',
                                     'escalate_governance','no_action')),
            ts                      INTEGER NOT NULL
        );
CREATE INDEX idx_mlsc_user_env_layers
            ON ml_systemic_contradictions(user_id, resolved_env, layer_a, layer_b);
CREATE TABLE ml_self_capability_graph (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            capability_id       TEXT NOT NULL UNIQUE,
            module_id           TEXT NOT NULL,
            module_kind         TEXT NOT NULL CHECK(module_kind IN
                                ('detector','scorer','policy','execution',
                                 'memory_learning','safety')),
            health              REAL NOT NULL CHECK(health >= 0 AND health <= 1),
            reliability         REAL NOT NULL CHECK(reliability >= 0 AND reliability <= 1),
            recency             REAL NOT NULL CHECK(recency >= 0 AND recency <= 1),
            trust_score         REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            state               TEXT NOT NULL CHECK(state IN
                                ('strong','degraded','uncertain','unavailable')),
            ts_last_assessed    INTEGER NOT NULL,
            ts_created          INTEGER NOT NULL
        );
CREATE INDEX idx_mlscg_user_env_state_kind
            ON ml_self_capability_graph(user_id, resolved_env, state, module_kind);
CREATE TABLE ml_introspective_summaries (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            summary_id               TEXT NOT NULL UNIQUE,
            decision_id              TEXT NOT NULL,
            modules_relied_on_json   TEXT NOT NULL,
            self_trust_aggregate     REAL NOT NULL CHECK(self_trust_aggregate >= 0 AND self_trust_aggregate <= 1),
            confidence_modifier      REAL NOT NULL CHECK(confidence_modifier >= 0 AND confidence_modifier <= 1),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlis_user_env_decision_ts
            ON ml_introspective_summaries(user_id, resolved_env, decision_id, ts);
CREATE TABLE ml_primitive_proposals (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            proposal_id          TEXT NOT NULL UNIQUE,
            target_kind          TEXT NOT NULL CHECK(target_kind IN
                                 ('concept','regime_primitive')),
            operation            TEXT NOT NULL CHECK(operation IN
                                 ('add','split','merge','rename',
                                  'widen','narrow','remove_redundant')),
            proposal_summary     TEXT NOT NULL,
            explanatory_gain     REAL NOT NULL CHECK(explanatory_gain >= 0 AND explanatory_gain <= 1),
            compression_gain     REAL NOT NULL CHECK(compression_gain >= 0 AND compression_gain <= 1),
            predictive_gain      REAL NOT NULL CHECK(predictive_gain >= 0 AND predictive_gain <= 1),
            complexity_cost      REAL NOT NULL CHECK(complexity_cost >= 0 AND complexity_cost <= 1),
            net_score            REAL NOT NULL,
            status               TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN
                                 ('PROPOSED','SHADOW','CONFIRMED','REJECTED')),
            ts_proposed          INTEGER NOT NULL,
            ts_decided           INTEGER
        );
CREATE INDEX idx_mlpp_user_env_status
            ON ml_primitive_proposals(user_id, resolved_env, status);
CREATE TABLE ml_ontology_versions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            version_id               TEXT NOT NULL UNIQUE,
            version_number           INTEGER NOT NULL CHECK(version_number >= 1),
            applied_proposals_json   TEXT NOT NULL,
            revision_reason          TEXT NOT NULL,
            ts_applied               INTEGER NOT NULL
        );
CREATE INDEX idx_mlov_user_env_version
            ON ml_ontology_versions(user_id, resolved_env, version_number);
CREATE TABLE ml_worldview_agents (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            agent_id                 TEXT NOT NULL UNIQUE,
            worldview_kind           TEXT NOT NULL CHECK(worldview_kind IN
                                     ('trend_following','mean_reversion',
                                      'liquidity_hunt','macro_dominant',
                                      'risk_minimalist','custom')),
            priors_json              TEXT NOT NULL,
            signal_preferences_json  TEXT NOT NULL,
            is_active                INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
            ts_registered            INTEGER NOT NULL,
            ts_retired               INTEGER
        );
CREATE INDEX idx_mlwa_user_env_kind_active
            ON ml_worldview_agents(user_id, resolved_env, worldview_kind, is_active);
CREATE TABLE ml_plural_decisions (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id            TEXT NOT NULL UNIQUE,
            market_context_json    TEXT NOT NULL,
            votes_json             TEXT NOT NULL,
            dissent_index          REAL NOT NULL CHECK(dissent_index >= 0 AND dissent_index <= 1),
            dominant_agent_id      TEXT,
            consensus_action       TEXT NOT NULL CHECK(consensus_action IN
                                   ('proceed','reduce_size','wait',
                                    'active_sensing','observer')),
            ts                     INTEGER NOT NULL
        );
CREATE INDEX idx_mlpd_user_env_action_ts
            ON ml_plural_decisions(user_id, resolved_env, consensus_action, ts);
CREATE TABLE ml_tension_assessments (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id        TEXT NOT NULL UNIQUE,
            sources_json         TEXT NOT NULL,
            tension_score        REAL NOT NULL CHECK(tension_score >= 0 AND tension_score <= 1),
            gradient_kind        TEXT NOT NULL CHECK(gradient_kind IN
                                 ('local','global','persistent','acute')),
            recommended_state    TEXT NOT NULL CHECK(recommended_state IN
                                 ('continue','caution','reduce_size',
                                  'observer','full_freeze')),
            ts                   INTEGER NOT NULL
        );
CREATE INDEX idx_mlta_user_env_state_ts
            ON ml_tension_assessments(user_id, resolved_env, recommended_state, ts);
CREATE TABLE ml_tension_sources_audit (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id             TEXT NOT NULL UNIQUE,
            assessment_id        TEXT NOT NULL,
            source_kind          TEXT NOT NULL CHECK(source_kind IN
                                 ('hypotheses','thesis_nodes','regime_beliefs',
                                  'confidence_bounds','unknowns','competence',
                                  'operational_health','utility_priorities')),
            contribution_score   REAL NOT NULL CHECK(contribution_score >= 0 AND contribution_score <= 1),
            notes                TEXT,
            ts                   INTEGER NOT NULL
        );
CREATE INDEX idx_mltsa_user_env_assessment_source
            ON ml_tension_sources_audit(user_id, resolved_env, assessment_id, source_kind);
CREATE TABLE ml_confidence_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            decision_id                 TEXT NOT NULL,
            primary_confidence          REAL NOT NULL CHECK(primary_confidence >= 0 AND primary_confidence <= 1),
            confidence_of_confidence    REAL NOT NULL CHECK(confidence_of_confidence >= 0 AND confidence_of_confidence <= 1),
            calibration_reliability     REAL NOT NULL CHECK(calibration_reliability >= 0 AND calibration_reliability <= 1),
            local_drift                 REAL NOT NULL CHECK(local_drift >= 0 AND local_drift <= 1),
            quadrant                    TEXT NOT NULL CHECK(quadrant IN
                                        ('high_conf_robust','high_conf_fragile',
                                         'low_conf_robust','low_conf_noisy')),
            penalized_confidence        REAL NOT NULL CHECK(penalized_confidence >= 0 AND penalized_confidence <= 1),
            recommended_action          TEXT NOT NULL CHECK(recommended_action IN
                                        ('proceed','size_reduce','wait',
                                         'active_sensing','observer')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlca_user_env_quadrant_ts
            ON ml_confidence_assessments(user_id, resolved_env, quadrant, ts);
CREATE TABLE ml_calibration_drift_audit (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id          TEXT NOT NULL UNIQUE,
            assessment_id     TEXT NOT NULL,
            drift_source      TEXT NOT NULL,
            drift_magnitude   REAL NOT NULL CHECK(drift_magnitude >= 0 AND drift_magnitude <= 1),
            notes             TEXT,
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mlcda_user_env_assessment_ts
            ON ml_calibration_drift_audit(user_id, resolved_env, assessment_id, ts);
CREATE TABLE ml_identity_snapshots (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                   TEXT NOT NULL UNIQUE,
            version_label                 TEXT NOT NULL,
            charter_hash                  TEXT NOT NULL,
            ontology_hash                 TEXT NOT NULL,
            concepts_hash                 TEXT NOT NULL,
            utility_priorities_hash       TEXT NOT NULL,
            regime_grammar_hash           TEXT NOT NULL,
            policy_style_hash             TEXT NOT NULL,
            risk_philosophy_hash          TEXT NOT NULL,
            ts                            INTEGER NOT NULL
        );
CREATE INDEX idx_mlis_user_env_version_ts
            ON ml_identity_snapshots(user_id, resolved_env, version_label, ts);
CREATE TABLE ml_identity_drift_audits (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id           TEXT NOT NULL UNIQUE,
            from_snapshot_id   TEXT NOT NULL,
            to_snapshot_id     TEXT NOT NULL,
            axis_drifts_json   TEXT NOT NULL,
            continuity_score   REAL NOT NULL CHECK(continuity_score >= 0 AND continuity_score <= 1),
            drift_kind         TEXT NOT NULL CHECK(drift_kind IN
                               ('evolution_normal','identity_drift',
                                'major_self_rewrite','forced_governance_review')),
            ts                 INTEGER NOT NULL
        );
CREATE INDEX idx_mlida_user_env_drift_ts
            ON ml_identity_drift_audits(user_id, resolved_env, drift_kind, ts);
CREATE TABLE ml_consensus_dependence_edges (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            edge_id               TEXT NOT NULL UNIQUE,
            signal_id             TEXT NOT NULL,
            upstream_source_id    TEXT NOT NULL,
            ts                    INTEGER NOT NULL
        );
CREATE INDEX idx_mlcde_user_env_signal_ts
            ON ml_consensus_dependence_edges(user_id, resolved_env, signal_id, ts);
CREATE INDEX idx_mlcde_user_env_source_ts
            ON ml_consensus_dependence_edges(user_id, resolved_env, upstream_source_id, ts);
CREATE TABLE ml_consensus_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            signals_json                TEXT NOT NULL,
            raw_count                   INTEGER NOT NULL CHECK(raw_count >= 0),
            effective_count             REAL NOT NULL CHECK(effective_count >= 0),
            mean_pairwise_dependence    REAL NOT NULL CHECK(mean_pairwise_dependence >= 0 AND mean_pairwise_dependence <= 1),
            inflation_factor            REAL NOT NULL CHECK(inflation_factor >= 0 AND inflation_factor <= 1),
            verdict                     TEXT NOT NULL CHECK(verdict IN
                                        ('robust_independent','partially_shared',
                                         'highly_coupled_pseudo')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlca_user_env_verdict_ts
            ON ml_consensus_assessments(user_id, resolved_env, verdict, ts);
CREATE TABLE ml_assumptions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assumption_id   TEXT NOT NULL UNIQUE,
            decision_id     TEXT NOT NULL,
            premise_type    TEXT NOT NULL CHECK(premise_type IN
                            ('structural','causal','execution',
                             'data_integrity','regime_persistence',
                             'cross_venue_validity')),
            strength_level  TEXT NOT NULL CHECK(strength_level IN
                            ('strong','fragile','speculative')),
            fragility_score REAL NOT NULL CHECK(fragility_score >= 0 AND fragility_score <= 1),
            statement       TEXT NOT NULL,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mla_user_env_decision_ts
            ON ml_assumptions(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mla_user_env_strength_ts
            ON ml_assumptions(user_id, resolved_env, strength_level, ts);
CREATE TABLE ml_assumption_dependencies (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            dependency_id          TEXT NOT NULL UNIQUE,
            parent_assumption_id   TEXT NOT NULL,
            child_assumption_id    TEXT NOT NULL,
            ts                     INTEGER NOT NULL,
            CHECK(parent_assumption_id <> child_assumption_id)
        );
CREATE INDEX idx_mlad_user_env_parent_ts
            ON ml_assumption_dependencies(user_id, resolved_env, parent_assumption_id, ts);
CREATE INDEX idx_mlad_user_env_child_ts
            ON ml_assumption_dependencies(user_id, resolved_env, child_assumption_id, ts);
CREATE TABLE ml_mind_change_criteria (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            criterion_id        TEXT NOT NULL UNIQUE,
            belief_id           TEXT NOT NULL,
            reversal_action     TEXT NOT NULL CHECK(reversal_action IN
                                ('weakening','flipping','abandoning','escalating')),
            trigger_condition   TEXT NOT NULL,
            evidence_threshold  REAL NOT NULL CHECK(evidence_threshold >= 0 AND evidence_threshold <= 1),
            inertia_factor      REAL NOT NULL CHECK(inertia_factor >= 0 AND inertia_factor <= 1),
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlmcc_user_env_belief_ts
            ON ml_mind_change_criteria(user_id, resolved_env, belief_id, ts);
CREATE INDEX idx_mlmcc_user_env_action_ts
            ON ml_mind_change_criteria(user_id, resolved_env, reversal_action, ts);
CREATE TABLE ml_mind_change_events (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_id             TEXT NOT NULL UNIQUE,
            criterion_id         TEXT NOT NULL,
            actual_evidence      REAL NOT NULL CHECK(actual_evidence >= 0),
            surprise_score       REAL NOT NULL CHECK(surprise_score >= 0 AND surprise_score <= 1),
            reversal_executed    INTEGER NOT NULL CHECK(reversal_executed IN (0,1)),
            ts                   INTEGER NOT NULL
        );
CREATE INDEX idx_mlmce_user_env_criterion_ts
            ON ml_mind_change_events(user_id, resolved_env, criterion_id, ts);
CREATE TABLE ml_abstraction_log (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id            INTEGER NOT NULL,
            resolved_env       TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id           TEXT NOT NULL UNIQUE,
            decision_id        TEXT NOT NULL,
            abstraction_level  TEXT NOT NULL CHECK(abstraction_level IN
                               ('tick_microstructure','execution',
                                'intraday_structure','htf_regime',
                                'macro_cross_asset','strategic_constitutional')),
            prev_level         TEXT CHECK(prev_level IS NULL OR prev_level IN
                               ('tick_microstructure','execution',
                                'intraday_structure','htf_regime',
                                'macro_cross_asset','strategic_constitutional')),
            switch_action      TEXT NOT NULL CHECK(switch_action IN
                               ('initial','descend','rise','stay')),
            cost_score         REAL NOT NULL CHECK(cost_score >= 0 AND cost_score <= 1),
            benefit_score      REAL NOT NULL CHECK(benefit_score >= 0 AND benefit_score <= 1),
            net_value          REAL NOT NULL,
            ts                 INTEGER NOT NULL
        );
CREATE INDEX idx_mlal_user_env_decision_ts
            ON ml_abstraction_log(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mlal_user_env_level_ts
            ON ml_abstraction_log(user_id, resolved_env, abstraction_level, ts);
CREATE TABLE ml_grounding_anchors (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            anchor_id       TEXT NOT NULL UNIQUE,
            concept_name    TEXT NOT NULL,
            metric_name     TEXT NOT NULL,
            threshold_min   REAL,
            threshold_max   REAL,
            active          INTEGER NOT NULL CHECK(active IN (0,1)),
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlga_user_env_concept_active
            ON ml_grounding_anchors(user_id, resolved_env, concept_name, active);
CREATE TABLE ml_grounding_checks (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            check_id                 TEXT NOT NULL UNIQUE,
            concept_name             TEXT NOT NULL,
            actual_metrics_json      TEXT NOT NULL,
            matched_anchors_count    INTEGER NOT NULL CHECK(matched_anchors_count >= 0),
            total_anchors_count      INTEGER NOT NULL CHECK(total_anchors_count >= 0),
            grounding_score          REAL NOT NULL CHECK(grounding_score >= 0 AND grounding_score <= 1),
            grounding_status         TEXT NOT NULL CHECK(grounding_status IN
                                    ('well_grounded','partial_grounded','rhetorical')),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlgc_user_env_concept_ts
            ON ml_grounding_checks(user_id, resolved_env, concept_name, ts);
CREATE TABLE ml_steelman_arguments (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            argument_id              TEXT NOT NULL UNIQUE,
            against_thesis_type      TEXT NOT NULL,
            argument_text            TEXT NOT NULL,
            argument_strength        REAL NOT NULL CHECK(argument_strength >= 0 AND argument_strength <= 1),
            evidence_requirements_json TEXT NOT NULL,
            active                   INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlsa_user_env_type_active
            ON ml_steelman_arguments(user_id, resolved_env, against_thesis_type, active);
CREATE TABLE ml_steelman_constructions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            construction_id          TEXT NOT NULL UNIQUE,
            decision_id              TEXT NOT NULL,
            primary_thesis           TEXT NOT NULL,
            opposing_thesis_type     TEXT NOT NULL,
            selected_arguments_json  TEXT NOT NULL,
            composed_steelman        TEXT NOT NULL,
            quality_score            REAL NOT NULL CHECK(quality_score >= 0 AND quality_score <= 1),
            quality_verdict          TEXT NOT NULL CHECK(quality_verdict IN
                                     ('weak','moderate','strong')),
            primary_conviction       REAL NOT NULL CHECK(primary_conviction >= 0 AND primary_conviction <= 1),
            decision_approved        INTEGER NOT NULL CHECK(decision_approved IN (0,1)),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlsc_user_env_decision_ts
            ON ml_steelman_constructions(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mlsc_user_env_verdict_ts
            ON ml_steelman_constructions(user_id, resolved_env, quality_verdict, ts);
CREATE TABLE ml_representation_observations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id           TEXT NOT NULL UNIQUE,
            representation_kind      TEXT NOT NULL CHECK(representation_kind IN
                                     ('concept','regime','primitive',
                                      'explanation','ontology')),
            representation_id        TEXT NOT NULL,
            predicted_outcome_json   TEXT NOT NULL,
            actual_outcome_json      TEXT NOT NULL,
            misfit_score             REAL NOT NULL CHECK(misfit_score >= 0 AND misfit_score <= 1),
            misfit_kind              TEXT NOT NULL CHECK(misfit_kind IN
                                     ('no_misfit','compression_excessive',
                                      'forced_category',
                                      'over_confident_under_explanatory')),
            prediction_confidence    REAL NOT NULL CHECK(prediction_confidence >= 0 AND prediction_confidence <= 1),
            explanatory_power        REAL NOT NULL CHECK(explanatory_power >= 0 AND explanatory_power <= 1),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlro_user_env_kind_repr_ts
            ON ml_representation_observations(user_id, resolved_env,
                                               representation_kind,
                                               representation_id, ts);
CREATE TABLE ml_representation_debt_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id              TEXT NOT NULL UNIQUE,
            representation_kind      TEXT NOT NULL CHECK(representation_kind IN
                                     ('concept','regime','primitive',
                                      'explanation','ontology')),
            window_start_ts          INTEGER NOT NULL,
            window_end_ts            INTEGER NOT NULL,
            observations_count       INTEGER NOT NULL CHECK(observations_count >= 0),
            mean_misfit              REAL NOT NULL CHECK(mean_misfit >= 0 AND mean_misfit <= 1),
            debt_score               REAL NOT NULL CHECK(debt_score >= 0 AND debt_score <= 1),
            debt_verdict             TEXT NOT NULL CHECK(debt_verdict IN
                                     ('healthy','accumulating','critical')),
            revision_recommendation  TEXT NOT NULL,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlrds_user_env_kind_ts
            ON ml_representation_debt_snapshots(user_id, resolved_env,
                                                 representation_kind, ts);
CREATE TABLE ml_humility_assessments (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id              TEXT NOT NULL UNIQUE,
            decision_id                TEXT NOT NULL,
            primary_confidence         REAL NOT NULL CHECK(primary_confidence >= 0 AND primary_confidence <= 1),
            confidence_of_confidence   REAL NOT NULL CHECK(confidence_of_confidence >= 0 AND confidence_of_confidence <= 1),
            competence_score           REAL NOT NULL CHECK(competence_score >= 0 AND competence_score <= 1),
            unknowns_debt              REAL NOT NULL CHECK(unknowns_debt >= 0 AND unknowns_debt <= 1),
            false_consensus_penalty    REAL NOT NULL CHECK(false_consensus_penalty >= 0 AND false_consensus_penalty <= 1),
            representation_debt        REAL NOT NULL CHECK(representation_debt >= 0 AND representation_debt <= 1),
            tension_field_level        REAL NOT NULL CHECK(tension_field_level >= 0 AND tension_field_level <= 1),
            humility_score             REAL NOT NULL CHECK(humility_score >= 0 AND humility_score <= 1),
            boldness_permission        TEXT NOT NULL CHECK(boldness_permission IN
                                       ('humble_observer','moderate','bold')),
            size_multiplier            REAL NOT NULL CHECK(size_multiplier >= 0 AND size_multiplier <= 1),
            ts                         INTEGER NOT NULL
        );
CREATE INDEX idx_mlha_user_env_decision_ts
            ON ml_humility_assessments(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mlha_user_env_perm_ts
            ON ml_humility_assessments(user_id, resolved_env, boldness_permission, ts);
CREATE TABLE ml_action_optionality_assessments (
            id                           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                      INTEGER NOT NULL,
            resolved_env                 TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                TEXT NOT NULL UNIQUE,
            action_id                    TEXT NOT NULL,
            action_kind                  TEXT NOT NULL,
            expected_value               REAL NOT NULL,
            irreversibility_score        REAL NOT NULL CHECK(irreversibility_score >= 0 AND irreversibility_score <= 1),
            optionality_consumed         REAL NOT NULL CHECK(optionality_consumed >= 0 AND optionality_consumed <= 1),
            future_options_killed_count  INTEGER NOT NULL CHECK(future_options_killed_count >= 0),
            epistemic_standard_required  REAL NOT NULL CHECK(epistemic_standard_required >= 0 AND epistemic_standard_required <= 1),
            primary_conviction           REAL NOT NULL CHECK(primary_conviction >= 0 AND primary_conviction <= 1),
            reversibility_category       TEXT NOT NULL CHECK(reversibility_category IN
                                         ('reversible','partial_reversible','nearly_irreversible')),
            net_value_after_penalty      REAL NOT NULL,
            approved                     INTEGER NOT NULL CHECK(approved IN (0,1)),
            ts                           INTEGER NOT NULL
        );
CREATE INDEX idx_mlaoa_user_env_action_ts
            ON ml_action_optionality_assessments(user_id, resolved_env, action_id, ts);
CREATE INDEX idx_mlaoa_user_env_category_ts
            ON ml_action_optionality_assessments(user_id, resolved_env, reversibility_category, ts);
CREATE TABLE ml_explanation_assessments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id       TEXT NOT NULL UNIQUE,
            decision_id         TEXT NOT NULL,
            explanation_text    TEXT NOT NULL,
            word_count          INTEGER NOT NULL CHECK(word_count >= 1),
            claim_count         INTEGER NOT NULL CHECK(claim_count >= 0),
            premise_count       INTEGER NOT NULL CHECK(premise_count >= 0),
            explanatory_power   REAL NOT NULL CHECK(explanatory_power >= 0 AND explanatory_power <= 1),
            compression_score   REAL NOT NULL CHECK(compression_score >= 0 AND compression_score <= 1),
            density_metric      REAL NOT NULL CHECK(density_metric >= 0 AND density_metric <= 1),
            is_circular         INTEGER NOT NULL CHECK(is_circular IN (0,1)),
            issue_kind          TEXT NOT NULL CHECK(issue_kind IN
                                ('healthy','redundant','circular',
                                 'decorative','over_compressed')),
            trust_penalty       REAL NOT NULL CHECK(trust_penalty >= 0 AND trust_penalty <= 1),
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlea_user_env_decision_ts
            ON ml_explanation_assessments(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mlea_user_env_issue_ts
            ON ml_explanation_assessments(user_id, resolved_env, issue_kind, ts);
CREATE TABLE ml_alien_frames (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            frame_id                 TEXT NOT NULL UNIQUE,
            frame_name               TEXT NOT NULL,
            frame_description        TEXT NOT NULL,
            primary_primitives_json  TEXT NOT NULL,
            source_metaphor          TEXT NOT NULL,
            mode                     TEXT NOT NULL CHECK(mode IN
                                     ('sandbox','shadow','live_candidate')),
            explanatory_novelty      REAL NOT NULL CHECK(explanatory_novelty >= 0 AND explanatory_novelty <= 1),
            predictive_novelty       REAL NOT NULL CHECK(predictive_novelty >= 0 AND predictive_novelty <= 1),
            semantic_compression     REAL NOT NULL CHECK(semantic_compression >= 0 AND semantic_compression <= 1),
            stability_score          REAL NOT NULL CHECK(stability_score >= 0 AND stability_score <= 1),
            overall_value_score      REAL NOT NULL CHECK(overall_value_score >= 0 AND overall_value_score <= 1),
            active                   INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlaf_user_env_mode_active
            ON ml_alien_frames(user_id, resolved_env, mode, active);
CREATE TABLE ml_alien_frame_comparisons (
            id                        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                   INTEGER NOT NULL,
            resolved_env              TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            comparison_id             TEXT NOT NULL UNIQUE,
            frame_id                  TEXT NOT NULL,
            baseline_ontology_id      TEXT NOT NULL,
            test_case_count           INTEGER NOT NULL CHECK(test_case_count >= 0),
            frame_wins_count          INTEGER NOT NULL CHECK(frame_wins_count >= 0),
            baseline_wins_count       INTEGER NOT NULL CHECK(baseline_wins_count >= 0),
            draw_count                INTEGER NOT NULL CHECK(draw_count >= 0),
            frame_advantage_score     REAL NOT NULL CHECK(frame_advantage_score >= -1 AND frame_advantage_score <= 1),
            ts                        INTEGER NOT NULL
        );
CREATE INDEX idx_mlafc_user_env_frame_ts
            ON ml_alien_frame_comparisons(user_id, resolved_env, frame_id, ts);
CREATE TABLE ml_temporal_commitments (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            commitment_id     TEXT NOT NULL UNIQUE,
            commitment_kind   TEXT NOT NULL CHECK(commitment_kind IN
                              ('no_altcoins_until','no_trade_before_event',
                               'max_long_exposure',
                               'observer_until_regime_clarified',
                               'reduced_size_until_reconciliation',
                               'custom')),
            title             TEXT NOT NULL,
            description       TEXT NOT NULL,
            parameters_json   TEXT NOT NULL,
            strength_level    TEXT NOT NULL CHECK(strength_level IN
                              ('soft','medium','hard')),
            start_ts          INTEGER NOT NULL,
            expires_ts        INTEGER,
            status            TEXT NOT NULL CHECK(status IN
                              ('active','fulfilled','violated','expired')),
            ts                INTEGER NOT NULL
        );
CREATE INDEX idx_mltc_user_env_status_ts
            ON ml_temporal_commitments(user_id, resolved_env, status, ts);
CREATE INDEX idx_mltc_user_env_kind_ts
            ON ml_temporal_commitments(user_id, resolved_env, commitment_kind, ts);
CREATE TABLE ml_commitment_violations (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id             TEXT NOT NULL UNIQUE,
            commitment_id            TEXT NOT NULL,
            violation_kind           TEXT NOT NULL CHECK(violation_kind IN
                                     ('unjustified','justified_override','partial')),
            override_justification   TEXT NOT NULL,
            epistemic_cost           REAL NOT NULL CHECK(epistemic_cost >= 0 AND epistemic_cost <= 1),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlcv_user_env_commitment_ts
            ON ml_commitment_violations(user_id, resolved_env, commitment_id, ts);
CREATE TABLE ml_quarantined_ideas (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            idea_id                  TEXT NOT NULL UNIQUE,
            idea_kind                TEXT NOT NULL CHECK(idea_kind IN
                                     ('concept','rule','causality',
                                      'heuristic','signal','ontology')),
            title                    TEXT NOT NULL,
            description              TEXT NOT NULL,
            stage                    TEXT NOT NULL CHECK(stage IN
                                     ('idea_detected','quarantined',
                                      'replay_tested','shadow_tested',
                                      'canary_influence','core_admitted',
                                      'retired')),
            contamination_risk       REAL NOT NULL CHECK(contamination_risk >= 0 AND contamination_risk <= 1),
            incubation_started_ts    INTEGER,
            replay_test_passed       INTEGER NOT NULL CHECK(replay_test_passed IN (0,1)),
            shadow_test_passed       INTEGER NOT NULL CHECK(shadow_test_passed IN (0,1)),
            canary_test_passed       INTEGER NOT NULL CHECK(canary_test_passed IN (0,1)),
            decision_count           INTEGER NOT NULL CHECK(decision_count >= 0),
            active                   INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlqi_user_env_stage_active
            ON ml_quarantined_ideas(user_id, resolved_env, stage, active);
CREATE INDEX idx_mlqi_user_env_kind_ts
            ON ml_quarantined_ideas(user_id, resolved_env, idea_kind, ts);
CREATE TABLE ml_idea_promotions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            promotion_id    TEXT NOT NULL UNIQUE,
            idea_id         TEXT NOT NULL,
            from_stage      TEXT NOT NULL CHECK(from_stage IN
                            ('idea_detected','quarantined','replay_tested',
                             'shadow_tested','canary_influence',
                             'core_admitted','retired')),
            to_stage        TEXT NOT NULL CHECK(to_stage IN
                            ('idea_detected','quarantined','replay_tested',
                             'shadow_tested','canary_influence',
                             'core_admitted','retired')),
            reason          TEXT NOT NULL,
            ts              INTEGER NOT NULL
        );
CREATE INDEX idx_mlip_user_env_idea_ts
            ON ml_idea_promotions(user_id, resolved_env, idea_id, ts);
CREATE TABLE ml_ergodicity_assessments (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                 TEXT NOT NULL UNIQUE,
            vol_expansion_rate            REAL NOT NULL,
            sequential_drawdown           REAL NOT NULL CHECK(sequential_drawdown >= 0),
            relative_leverage_increase    REAL NOT NULL,
            non_ergodicity_score          REAL NOT NULL CHECK(non_ergodicity_score >= 0 AND non_ergodicity_score <= 1),
            regime                        TEXT NOT NULL CHECK(regime IN
                                          ('ergodic_normal','non_ergodic_survival')),
            framework_mode                TEXT NOT NULL CHECK(framework_mode IN
                                          ('expected_value','minimax_survival')),
            triggered_signals_json        TEXT NOT NULL,
            ts                            INTEGER NOT NULL
        );
CREATE INDEX idx_mlea_user_env_regime_ts
            ON ml_ergodicity_assessments(user_id, resolved_env, regime, ts);
CREATE INDEX idx_mlea_user_env_ts
            ON ml_ergodicity_assessments(user_id, resolved_env, ts);
CREATE TABLE ml_ergodicity_regime_transitions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id            TEXT NOT NULL UNIQUE,
            from_regime              TEXT NOT NULL CHECK(from_regime IN
                                     ('ergodic_normal','non_ergodic_survival')),
            to_regime                TEXT NOT NULL CHECK(to_regime IN
                                     ('ergodic_normal','non_ergodic_survival')),
            trigger_signals_json     TEXT NOT NULL,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlert_user_env_ts
            ON ml_ergodicity_regime_transitions(user_id, resolved_env, ts);
CREATE TABLE ml_metacognitive_load_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            active_hypotheses_count     INTEGER NOT NULL CHECK(active_hypotheses_count >= 0),
            managed_positions_count     INTEGER NOT NULL CHECK(managed_positions_count >= 0),
            degraded_modules_count      INTEGER NOT NULL CHECK(degraded_modules_count >= 0),
            scenario_tree_depth         INTEGER NOT NULL CHECK(scenario_tree_depth >= 0),
            belief_updates_queue_size   INTEGER NOT NULL CHECK(belief_updates_queue_size >= 0),
            load_score                  REAL NOT NULL CHECK(load_score >= 0 AND load_score <= 1),
            cognitive_mode              TEXT NOT NULL CHECK(cognitive_mode IN
                                        ('normal','elevated','overloaded')),
            intervention_applied        TEXT NOT NULL CHECK(intervention_applied IN
                                        ('none','simplify_hypotheses','simple_rules_mode')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlmla_user_env_mode_ts
            ON ml_metacognitive_load_assessments(user_id, resolved_env, cognitive_mode, ts);
CREATE INDEX idx_mlmla_user_env_ts
            ON ml_metacognitive_load_assessments(user_id, resolved_env, ts);
CREATE TABLE ml_gravity_zones (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            zone_id                         TEXT NOT NULL UNIQUE,
            asset                           TEXT NOT NULL,
            zone_kind                       TEXT NOT NULL CHECK(zone_kind IN
                                            ('futures_expiry','gamma_wall',
                                             'twap_target','liquidation_cluster',
                                             'funding_arbitrage')),
            settlement_type                 TEXT NOT NULL CHECK(settlement_type IN
                                            ('cme_quarterly','monthly_options',
                                             'perpetual_funding','twap_window',
                                             'liquidation_cascade')),
            zone_center_price               REAL NOT NULL CHECK(zone_center_price > 0),
            gravity_strength                REAL NOT NULL CHECK(gravity_strength >= 0 AND gravity_strength <= 1),
            confidence_score                REAL NOT NULL CHECK(confidence_score >= 0 AND confidence_score <= 1),
            source_quality_score            REAL NOT NULL CHECK(source_quality_score >= 0 AND source_quality_score <= 1),
            liquidity_depth_score           REAL NOT NULL CHECK(liquidity_depth_score >= 0 AND liquidity_depth_score <= 1),
            volatility_sensitivity_score    REAL NOT NULL CHECK(volatility_sensitivity_score >= 0 AND volatility_sensitivity_score <= 1),
            time_to_settlement_ms           INTEGER NOT NULL CHECK(time_to_settlement_ms >= 0),
            zone_expires_at_ts              INTEGER NOT NULL,
            source_data_json                TEXT NOT NULL,
            active                          INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                              INTEGER NOT NULL
        , lifecycle_state TEXT NOT NULL DEFAULT 'active', inference_method TEXT NOT NULL DEFAULT 'manual', model_version TEXT, source_provider TEXT);
CREATE INDEX idx_mlgz_user_env_asset_kind_active
            ON ml_gravity_zones(user_id, resolved_env, asset, zone_kind, active);
CREATE INDEX idx_mlgz_user_env_expires
            ON ml_gravity_zones(user_id, resolved_env, zone_expires_at_ts);
CREATE TABLE ml_gravity_observations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id                  TEXT NOT NULL UNIQUE,
            zone_id                         TEXT NOT NULL,
            predicted_settlement_price      REAL NOT NULL CHECK(predicted_settlement_price > 0),
            actual_price_at_settlement      REAL NOT NULL CHECK(actual_price_at_settlement > 0),
            observation_window_ms           INTEGER NOT NULL CHECK(observation_window_ms >= 0),
            distance_to_target_pct          REAL NOT NULL,
            prediction_was_correct          INTEGER NOT NULL CHECK(prediction_was_correct IN (0,1)),
            tolerance_pct                   REAL NOT NULL CHECK(tolerance_pct >= 0 AND tolerance_pct <= 1),
            ts                              INTEGER NOT NULL, settlement_accuracy_score REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(zone_id) REFERENCES ml_gravity_zones(zone_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlgo_user_env_zone_ts
            ON ml_gravity_observations(user_id, resolved_env, zone_id, ts);
CREATE TABLE ml_gravity_conflicts (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            conflict_id                 TEXT NOT NULL UNIQUE,
            asset                       TEXT NOT NULL,
            participating_zone_ids_json TEXT NOT NULL,
            gravity_conflict_score      REAL NOT NULL CHECK(gravity_conflict_score >= 0 AND gravity_conflict_score <= 1),
            net_vector_direction        TEXT NOT NULL CHECK(net_vector_direction IN
                                        ('up','down','sideways')),
            dominant_zone_id            TEXT NOT NULL,
            ts                          INTEGER NOT NULL, net_vector_strength REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(dominant_zone_id) REFERENCES ml_gravity_zones(zone_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlgc_user_env_asset_ts
            ON ml_gravity_conflicts(user_id, resolved_env, asset, ts);
CREATE INDEX idx_mlgz_user_env_lifecycle_ts
            ON ml_gravity_zones(user_id, resolved_env, lifecycle_state, ts);
CREATE TABLE ml_gravity_conflict_members (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            resolved_env    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            conflict_id     TEXT NOT NULL,
            zone_id         TEXT NOT NULL,
            weight          REAL NOT NULL CHECK(weight >= 0 AND weight <= 1),
            ts              INTEGER NOT NULL,
            FOREIGN KEY(conflict_id) REFERENCES ml_gravity_conflicts(conflict_id) ON DELETE CASCADE,
            FOREIGN KEY(zone_id) REFERENCES ml_gravity_zones(zone_id) ON DELETE RESTRICT,
            UNIQUE(conflict_id, zone_id)
        );
CREATE INDEX idx_mlgcm_user_env_conflict
            ON ml_gravity_conflict_members(user_id, resolved_env, conflict_id);
CREATE INDEX idx_mlgcm_user_env_zone_ts
            ON ml_gravity_conflict_members(user_id, resolved_env, zone_id, ts);
CREATE TABLE ml_adversarial_attack_detections (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            detection_id             TEXT NOT NULL UNIQUE,
            asset                    TEXT NOT NULL,
            attack_pattern           TEXT NOT NULL CHECK(attack_pattern IN
                                     ('spoofing_storm','ghost_liquidity',
                                      'micro_cancel_pattern','volume_anomaly')),
            anomaly_score            REAL NOT NULL CHECK(anomaly_score >= 0 AND anomaly_score <= 1),
            severity                 TEXT NOT NULL CHECK(severity IN
                                     ('low','medium','high')),
            evidence_json            TEXT NOT NULL,
            defense_action           TEXT NOT NULL CHECK(defense_action IN
                                     ('ignore_signal','increase_caution','pause_trading')),
            ts                       INTEGER NOT NULL
        , detection_model_version TEXT NOT NULL DEFAULT 'v1.0.0', sanitization_policy_version TEXT NOT NULL DEFAULT 'v1.0.0', anomaly_embedding_json TEXT NOT NULL DEFAULT '[]', external_link_kind TEXT, external_link_id TEXT);
CREATE INDEX idx_mlaad_user_env_asset_pattern_ts
            ON ml_adversarial_attack_detections(user_id, resolved_env, asset, attack_pattern, ts);
CREATE INDEX idx_mlaad_user_env_severity_ts
            ON ml_adversarial_attack_detections(user_id, resolved_env, severity, ts);
CREATE TABLE ml_signal_sanitization_log (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            sanitization_id          TEXT NOT NULL UNIQUE,
            detection_id             TEXT NOT NULL,
            original_signal_json     TEXT NOT NULL,
            sanitized_signal_json    TEXT NOT NULL,
            sanitization_applied     INTEGER NOT NULL CHECK(sanitization_applied IN (0,1)),
            ts                       INTEGER NOT NULL, sanitization_policy_version TEXT NOT NULL DEFAULT 'v1.0.0',
            FOREIGN KEY(detection_id) REFERENCES ml_adversarial_attack_detections(detection_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlssl_user_env_detection_ts
            ON ml_signal_sanitization_log(user_id, resolved_env, detection_id, ts);
CREATE TABLE ml_obfuscated_orders (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            original_order_id        TEXT NOT NULL UNIQUE,
            asset                    TEXT NOT NULL,
            original_size            REAL NOT NULL CHECK(original_size > 0),
            original_order_type      TEXT NOT NULL CHECK(original_order_type IN
                                     ('limit','market','ioc','gtc','stop','stop_limit')),
            obfuscation_strategy     TEXT NOT NULL CHECK(obfuscation_strategy IN
                                     ('none','timing_jitter','size_split',
                                      'type_variation','full_obfuscation')),
            child_orders_json        TEXT NOT NULL,
            jitter_ms                INTEGER NOT NULL CHECK(jitter_ms >= 0),
            child_count              INTEGER NOT NULL CHECK(child_count >= 1),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mloo_user_env_asset_ts
            ON ml_obfuscated_orders(user_id, resolved_env, asset, ts);
CREATE INDEX idx_mloo_user_env_strategy_ts
            ON ml_obfuscated_orders(user_id, resolved_env, obfuscation_strategy, ts);
CREATE INDEX idx_mlaad_user_env_link_ts
            ON ml_adversarial_attack_detections(user_id, resolved_env, external_link_kind, external_link_id, ts);
CREATE TABLE ml_execution_optimization_orders (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            parent_order_id             TEXT NOT NULL UNIQUE,
            asset                       TEXT NOT NULL,
            original_size               REAL NOT NULL CHECK(original_size > 0),
            original_order_type         TEXT NOT NULL CHECK(original_order_type IN
                                        ('limit','market','ioc','gtc','stop','stop_limit')),
            execution_strategy          TEXT NOT NULL CHECK(execution_strategy IN
                                        ('passthrough','latency_buffered',
                                         'liquidity_based_splitting',
                                         'type_substitution',
                                         'optimized_distribution')),
            execution_intent            TEXT NOT NULL CHECK(execution_intent IN
                                        ('minimize_slippage','reduce_market_impact',
                                         'improve_fill_quality')),
            execution_delay_ms          INTEGER NOT NULL CHECK(execution_delay_ms >= 0),
            child_count                 INTEGER NOT NULL CHECK(child_count >= 1),
            execution_policy_version    TEXT NOT NULL DEFAULT 'v2.0.0',
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mleoo_user_env_asset_ts
            ON ml_execution_optimization_orders(user_id, resolved_env, asset, ts);
CREATE INDEX idx_mleoo_user_env_strategy_ts
            ON ml_execution_optimization_orders(user_id, resolved_env, execution_strategy, ts);
CREATE TABLE ml_execution_child_orders (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            child_order_id           TEXT NOT NULL UNIQUE,
            parent_order_id          TEXT NOT NULL,
            child_size               REAL NOT NULL CHECK(child_size > 0),
            child_order_type         TEXT NOT NULL CHECK(child_order_type IN
                                     ('limit','market','ioc','gtc','stop','stop_limit')),
            child_index              INTEGER NOT NULL CHECK(child_index >= 0),
            split_reason             TEXT NOT NULL,
            ts                       INTEGER NOT NULL,
            FOREIGN KEY(parent_order_id) REFERENCES ml_execution_optimization_orders(parent_order_id) ON DELETE CASCADE
        );
CREATE INDEX idx_mleco_user_env_parent_ts
            ON ml_execution_child_orders(user_id, resolved_env, parent_order_id, ts);
CREATE TABLE ml_consolidation_sessions (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            session_id                  TEXT NOT NULL UNIQUE,
            trigger_kind                TEXT NOT NULL CHECK(trigger_kind IN
                                        ('scheduled','episode_threshold','manual')),
            session_status              TEXT NOT NULL CHECK(session_status IN
                                        ('open','closed')),
            episodes_examined_count     INTEGER NOT NULL CHECK(episodes_examined_count >= 0),
            clusters_formed_count       INTEGER NOT NULL CHECK(clusters_formed_count >= 0),
            principles_extracted_count  INTEGER NOT NULL CHECK(principles_extracted_count >= 0),
            principles_promoted_count   INTEGER NOT NULL CHECK(principles_promoted_count >= 0),
            principles_rejected_count   INTEGER NOT NULL CHECK(principles_rejected_count >= 0),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlcs_user_env_trigger_ts
            ON ml_consolidation_sessions(user_id, resolved_env, trigger_kind, ts);
CREATE INDEX idx_mlcs_user_env_status_ts
            ON ml_consolidation_sessions(user_id, resolved_env, session_status, ts);
CREATE TABLE ml_consolidated_principles (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            principle_id             TEXT NOT NULL UNIQUE,
            session_id               TEXT NOT NULL,
            principle_text           TEXT NOT NULL,
            source_episode_ids_json  TEXT NOT NULL,
            generalizability_score   REAL NOT NULL CHECK(generalizability_score >= 0 AND generalizability_score <= 1),
            testability_score        REAL NOT NULL CHECK(testability_score >= 0 AND testability_score <= 1),
            transferability_score    REAL NOT NULL CHECK(transferability_score >= 0 AND transferability_score <= 1),
            overall_quality_score    REAL NOT NULL CHECK(overall_quality_score >= 0 AND overall_quality_score <= 1),
            status                   TEXT NOT NULL CHECK(status IN
                                     ('extracted','tested','promoted','rejected')),
            ts                       INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES ml_consolidation_sessions(session_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlcp_user_env_session_ts
            ON ml_consolidated_principles(user_id, resolved_env, session_id, ts);
CREATE INDEX idx_mlcp_user_env_status_ts
            ON ml_consolidated_principles(user_id, resolved_env, status, ts);
CREATE TABLE ml_source_trust_predictions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            prediction_id            TEXT NOT NULL UNIQUE,
            source_name              TEXT NOT NULL,
            regime                   TEXT NOT NULL CHECK(regime IN
                                     ('trend','range','chop','breakout')),
            setup_kind               TEXT NOT NULL,
            predicted_value_json     TEXT NOT NULL,
            actual_value_json        TEXT NOT NULL,
            accuracy_score           REAL NOT NULL CHECK(accuracy_score >= 0 AND accuracy_score <= 1),
            prediction_was_correct   INTEGER NOT NULL CHECK(prediction_was_correct IN (0,1)),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlstp_user_env_source_regime_ts
            ON ml_source_trust_predictions(user_id, resolved_env, source_name, regime, ts);
CREATE TABLE ml_source_trust_scores (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            score_id                 TEXT NOT NULL UNIQUE,
            source_name              TEXT NOT NULL,
            regime                   TEXT NOT NULL CHECK(regime IN
                                     ('trend','range','chop','breakout')),
            trust_score              REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            sample_count             INTEGER NOT NULL CHECK(sample_count >= 0),
            decayed_accuracy         REAL NOT NULL CHECK(decayed_accuracy >= 0 AND decayed_accuracy <= 1),
            confidence_in_score      REAL NOT NULL CHECK(confidence_in_score >= 0 AND confidence_in_score <= 1),
            last_updated_ts          INTEGER NOT NULL,
            ts                       INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, source_name, regime)
        );
CREATE INDEX idx_mlsts_user_env_source_regime
            ON ml_source_trust_scores(user_id, resolved_env, source_name, regime);
CREATE INDEX idx_mlsts_user_env_regime_trust
            ON ml_source_trust_scores(user_id, resolved_env, regime, trust_score);
CREATE TABLE ml_signal_tempos (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            tempo_id                TEXT NOT NULL UNIQUE,
            signal_kind             TEXT NOT NULL,
            signal_category         TEXT NOT NULL CHECK(signal_category IN
                                    ('microstructure','flow','structural','macro')),
            natural_period_ms       INTEGER NOT NULL CHECK(natural_period_ms > 0),
            period_tolerance_pct    REAL NOT NULL CHECK(period_tolerance_pct >= 0 AND period_tolerance_pct <= 1),
            active                  INTEGER NOT NULL CHECK(active IN (0,1)),
            ts                      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, signal_kind)
        );
CREATE INDEX idx_mlst_user_env_category_active
            ON ml_signal_tempos(user_id, resolved_env, signal_category, active);
CREATE TABLE ml_decision_tempo_assessments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id               TEXT NOT NULL UNIQUE,
            decision_id                 TEXT NOT NULL,
            decision_horizon_ms         INTEGER NOT NULL CHECK(decision_horizon_ms > 0),
            contributing_signals_json   TEXT NOT NULL,
            mean_signal_period_ms       REAL NOT NULL CHECK(mean_signal_period_ms > 0),
            resonance_score             REAL NOT NULL CHECK(resonance_score >= 0 AND resonance_score <= 1),
            desync_severity             TEXT NOT NULL CHECK(desync_severity IN
                                        ('in_sync','mild_desync','severe_desync')),
            decision_quality_penalty    REAL NOT NULL CHECK(decision_quality_penalty >= 0 AND decision_quality_penalty <= 1),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mldta_user_env_decision_ts
            ON ml_decision_tempo_assessments(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mldta_user_env_severity_ts
            ON ml_decision_tempo_assessments(user_id, resolved_env, desync_severity, ts);
CREATE TABLE ml_identity_transformation_tests (
            id                                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                                 INTEGER NOT NULL,
            resolved_env                            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            test_id                                 TEXT NOT NULL UNIQUE,
            baseline_snapshot_id                    TEXT NOT NULL,
            current_snapshot_id                     TEXT NOT NULL,
            charter_drift_score                     REAL NOT NULL CHECK(charter_drift_score >= 0 AND charter_drift_score <= 1),
            utility_function_drift_score            REAL NOT NULL CHECK(utility_function_drift_score >= 0 AND utility_function_drift_score <= 1),
            policy_style_drift_score                REAL NOT NULL CHECK(policy_style_drift_score >= 0 AND policy_style_drift_score <= 1),
            ontology_drift_score                    REAL NOT NULL CHECK(ontology_drift_score >= 0 AND ontology_drift_score <= 1),
            regime_interpretation_drift_score       REAL NOT NULL CHECK(regime_interpretation_drift_score >= 0 AND regime_interpretation_drift_score <= 1),
            boldness_humility_drift_score           REAL NOT NULL CHECK(boldness_humility_drift_score >= 0 AND boldness_humility_drift_score <= 1),
            replay_divergence_pct                   REAL NOT NULL CHECK(replay_divergence_pct >= 0 AND replay_divergence_pct <= 1),
            semantic_equivalence_score              REAL NOT NULL CHECK(semantic_equivalence_score >= 0 AND semantic_equivalence_score <= 1),
            composite_drift_score                   REAL NOT NULL CHECK(composite_drift_score >= 0 AND composite_drift_score <= 1),
            identity_verdict                        TEXT NOT NULL CHECK(identity_verdict IN
                                                    ('same_agent','evolved_variant','materially_new_agent')),
            governance_escalation_required          INTEGER NOT NULL CHECK(governance_escalation_required IN (0,1)),
            ts                                      INTEGER NOT NULL, drift_explanation_json TEXT NOT NULL DEFAULT '{}', identity_confidence_score REAL NOT NULL DEFAULT 1.0,
            FOREIGN KEY(baseline_snapshot_id) REFERENCES ml_identity_snapshots(snapshot_id) ON DELETE RESTRICT,
            FOREIGN KEY(current_snapshot_id) REFERENCES ml_identity_snapshots(snapshot_id) ON DELETE RESTRICT,
            CHECK(baseline_snapshot_id <> current_snapshot_id)
        );
CREATE INDEX idx_mlitt_user_env_verdict_ts
            ON ml_identity_transformation_tests(user_id, resolved_env, identity_verdict, ts);
CREATE INDEX idx_mlitt_user_env_escalation_ts
            ON ml_identity_transformation_tests(user_id, resolved_env, governance_escalation_required, ts);
CREATE TABLE ml_reason_commitments (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            commitment_id           TEXT NOT NULL UNIQUE,
            decision_id             TEXT NOT NULL,
            stage                   TEXT NOT NULL CHECK(stage IN
                                    ('pre_decision','post_decision','post_outcome')),
            reasons_text            TEXT NOT NULL,
            reasons_hash            TEXT NOT NULL,
            locked_at_ts            INTEGER NOT NULL,
            is_reinterpretation     INTEGER NOT NULL CHECK(is_reinterpretation IN (0,1)),
            ts                      INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, decision_id, stage)
        );
CREATE INDEX idx_mlrc_user_env_decision_stage
            ON ml_reason_commitments(user_id, resolved_env, decision_id, stage);
CREATE TABLE ml_honesty_audit_assessments (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                       TEXT NOT NULL UNIQUE,
            decision_id                         TEXT NOT NULL,
            pre_decision_commitment_id          TEXT NOT NULL,
            post_decision_commitment_id         TEXT,
            post_outcome_commitment_id          TEXT,
            pre_to_post_decision_drift          REAL NOT NULL CHECK(pre_to_post_decision_drift >= 0 AND pre_to_post_decision_drift <= 1),
            pre_to_post_outcome_drift           REAL NOT NULL CHECK(pre_to_post_outcome_drift >= 0 AND pre_to_post_outcome_drift <= 1),
            post_decision_to_post_outcome_drift REAL NOT NULL CHECK(post_decision_to_post_outcome_drift >= 0 AND post_decision_to_post_outcome_drift <= 1),
            max_drift_score                     REAL NOT NULL CHECK(max_drift_score >= 0 AND max_drift_score <= 1),
            rationalization_pattern             TEXT NOT NULL CHECK(rationalization_pattern IN
                                                ('none','post_hoc_beautification',
                                                 'explanatory_inflation','retrofitting_causal',
                                                 'self_excusing_narrative')),
            honesty_penalty                     REAL NOT NULL CHECK(honesty_penalty >= 0 AND honesty_penalty <= 1),
            investigation_required              INTEGER NOT NULL CHECK(investigation_required IN (0,1)),
            ts                                  INTEGER NOT NULL,
            FOREIGN KEY(pre_decision_commitment_id) REFERENCES ml_reason_commitments(commitment_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlhaa_user_env_decision_ts
            ON ml_honesty_audit_assessments(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mlhaa_user_env_pattern_ts
            ON ml_honesty_audit_assessments(user_id, resolved_env, rationalization_pattern, ts);
CREATE TABLE ml_open_remainder_observations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            observation_id              TEXT NOT NULL UNIQUE,
            decision_id                 TEXT,
            phenomenon_description      TEXT NOT NULL,
            attempted_categories_json   TEXT NOT NULL,
            best_match_score            REAL NOT NULL CHECK(best_match_score >= 0 AND best_match_score <= 1),
            residual_score              REAL NOT NULL CHECK(residual_score >= 0 AND residual_score <= 1),
            flagged_category            TEXT NOT NULL CHECK(flagged_category IN
                                        ('captured','partially_captured',
                                         'unexplained','forces_new_category')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mloro_user_env_flag_ts
            ON ml_open_remainder_observations(user_id, resolved_env, flagged_category, ts);
CREATE TABLE ml_ontological_humility_assessments (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                 TEXT NOT NULL UNIQUE,
            window_start_ts               INTEGER NOT NULL,
            window_end_ts                 INTEGER NOT NULL,
            observations_count            INTEGER NOT NULL CHECK(observations_count >= 0),
            mean_residual_score           REAL NOT NULL CHECK(mean_residual_score >= 0 AND mean_residual_score <= 1),
            overclosure_attempts_count    INTEGER NOT NULL CHECK(overclosure_attempts_count >= 0),
            humility_score                REAL NOT NULL CHECK(humility_score >= 0 AND humility_score <= 1),
            humility_level                TEXT NOT NULL CHECK(humility_level IN
                                          ('low','moderate','high')),
            aggression_penalty            REAL NOT NULL CHECK(aggression_penalty >= 0 AND aggression_penalty <= 1),
            recommended_action            TEXT NOT NULL CHECK(recommended_action IN
                                          ('continue','increase_observation','expand_ontology')),
            ts                            INTEGER NOT NULL
        );
CREATE INDEX idx_mloha_user_env_level_ts
            ON ml_ontological_humility_assessments(user_id, resolved_env, humility_level, ts);
CREATE TABLE ml_purpose_registry (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            purpose_id           TEXT NOT NULL UNIQUE,
            level                TEXT NOT NULL CHECK(level IN
                                 ('final','proximate','intermediate_metric','policy_action')),
            parent_purpose_id    TEXT,
            description          TEXT NOT NULL,
            telos_statement      TEXT,
            active               INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            created_at           INTEGER NOT NULL,
            retired_at           INTEGER,
            FOREIGN KEY(parent_purpose_id)
                REFERENCES ml_purpose_registry(purpose_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlpr_user_env_level_active
            ON ml_purpose_registry(user_id, resolved_env, level, active);
CREATE INDEX idx_mlpr_parent
            ON ml_purpose_registry(parent_purpose_id);
CREATE TABLE ml_purpose_drift_audits (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id                   TEXT NOT NULL UNIQUE,
            audited_purpose_id         TEXT NOT NULL,
            justification_score        REAL NOT NULL CHECK(justification_score >= 0 AND justification_score <= 1),
            substitution_pattern       TEXT CHECK(substitution_pattern IS NULL OR substitution_pattern IN
                                       ('metric_becomes_purpose','convenience_becomes_strategy',
                                        'safety_theater_becomes_paralysis','confidence_becomes_identity')),
            drift_score                REAL NOT NULL CHECK(drift_score >= 0 AND drift_score <= 1),
            drift_severity             TEXT NOT NULL CHECK(drift_severity IN ('none','moderate','severe')),
            recommended_action         TEXT NOT NULL CHECK(recommended_action IN
                                       ('continue','governance_review','retire_purpose')),
            ts                         INTEGER NOT NULL,
            FOREIGN KEY(audited_purpose_id)
                REFERENCES ml_purpose_registry(purpose_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlpda_user_env_purpose_ts
            ON ml_purpose_drift_audits(user_id, resolved_env, audited_purpose_id, ts);
CREATE INDEX idx_mlpda_severity_ts
            ON ml_purpose_drift_audits(drift_severity, ts);
CREATE TABLE ml_epistemic_regime_candidates (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            regime_id             TEXT NOT NULL UNIQUE,
            regime_name           TEXT NOT NULL,
            declared_priority     TEXT NOT NULL CHECK(declared_priority IN
                                  ('evidence','causality','prudence',
                                   'simplicity','antifragility','dissent')),
            description           TEXT NOT NULL,
            status                TEXT NOT NULL CHECK(status IN
                                  ('quarantined','shadow','canary','live','rejected')),
            registered_at         INTEGER NOT NULL,
            last_transition_at    INTEGER NOT NULL,
            last_transition_note  TEXT
        );
CREATE INDEX idx_mlerc_user_env_status
            ON ml_epistemic_regime_candidates(user_id, resolved_env, status);
CREATE INDEX idx_mlerc_priority
            ON ml_epistemic_regime_candidates(declared_priority);
CREATE TABLE ml_epistemic_regime_evaluations (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id                 TEXT NOT NULL UNIQUE,
            regime_id                     TEXT NOT NULL,
            eval_window_start_ts          INTEGER NOT NULL,
            eval_window_end_ts            INTEGER NOT NULL,
            robustness_score              REAL NOT NULL CHECK(robustness_score >= 0 AND robustness_score <= 1),
            coherence_score               REAL NOT NULL CHECK(coherence_score >= 0 AND coherence_score <= 1),
            humility_score                REAL NOT NULL CHECK(humility_score >= 0 AND humility_score <= 1),
            speed_score                   REAL NOT NULL CHECK(speed_score >= 0 AND speed_score <= 1),
            tail_survival_score           REAL NOT NULL CHECK(tail_survival_score >= 0 AND tail_survival_score <= 1),
            alpha_quality_score           REAL NOT NULL CHECK(alpha_quality_score >= 0 AND alpha_quality_score <= 1),
            composite_score               REAL NOT NULL CHECK(composite_score >= 0 AND composite_score <= 1),
            comparison_baseline_regime_id TEXT,
            verdict                       TEXT NOT NULL CHECK(verdict IN ('pass','fail','inconclusive')),
            ts                            INTEGER NOT NULL,
            FOREIGN KEY(regime_id)
                REFERENCES ml_epistemic_regime_candidates(regime_id) ON DELETE RESTRICT,
            FOREIGN KEY(comparison_baseline_regime_id)
                REFERENCES ml_epistemic_regime_candidates(regime_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlere_user_env_regime_ts
            ON ml_epistemic_regime_evaluations(user_id, resolved_env, regime_id, ts);
CREATE INDEX idx_mlere_verdict_ts
            ON ml_epistemic_regime_evaluations(verdict, ts);
CREATE TABLE ml_possible_self_archetypes (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER NOT NULL,
            resolved_env           TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            archetype_id           TEXT NOT NULL UNIQUE,
            archetype_name         TEXT NOT NULL CHECK(archetype_name IN
                                   ('conservative','aggressive','research_heavy',
                                    'survival_first','integrity_max','custom')),
            traits_json            TEXT NOT NULL,
            priority_weights_json  TEXT NOT NULL,
            description            TEXT NOT NULL,
            registered_at          INTEGER NOT NULL
        );
CREATE INDEX idx_mlpsa_user_env_name
            ON ml_possible_self_archetypes(user_id, resolved_env, archetype_name);
CREATE TABLE ml_future_self_treaties (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            treaty_id           TEXT NOT NULL UNIQUE,
            change_label        TEXT NOT NULL,
            archetype_id        TEXT NOT NULL,
            horizon             TEXT NOT NULL CHECK(horizon IN ('near_term','long_horizon')),
            approval_score      REAL NOT NULL CHECK(approval_score >= 0 AND approval_score <= 1),
            regret_score        REAL NOT NULL CHECK(regret_score >= 0 AND regret_score <= 1),
            treaty_score        REAL NOT NULL CHECK(treaty_score >= 0 AND treaty_score <= 1),
            verdict             TEXT NOT NULL CHECK(verdict IN
                                ('approve','quarantine','governance_review','reject')),
            reasoning_text      TEXT,
            ts                  INTEGER NOT NULL,
            FOREIGN KEY(archetype_id)
                REFERENCES ml_possible_self_archetypes(archetype_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlfst_user_env_change
            ON ml_future_self_treaties(user_id, resolved_env, change_label);
CREATE INDEX idx_mlfst_verdict_ts
            ON ml_future_self_treaties(verdict, ts);
CREATE INDEX idx_mlfst_archetype
            ON ml_future_self_treaties(archetype_id);
CREATE TABLE ml_expected_signals_registry (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            expected_signal_id       TEXT NOT NULL UNIQUE,
            event_trigger            TEXT NOT NULL,
            expected_signal_name     TEXT NOT NULL,
            normal_window_ms         INTEGER NOT NULL CHECK(normal_window_ms > 0),
            significant_window_ms    INTEGER NOT NULL CHECK(significant_window_ms > 0),
            max_window_ms            INTEGER NOT NULL CHECK(max_window_ms > 0),
            causal_interpretation    TEXT NOT NULL,
            thesis_link_label        TEXT,
            registered_at            INTEGER NOT NULL,
            CHECK(normal_window_ms <= significant_window_ms
                  AND significant_window_ms <= max_window_ms)
        );
CREATE INDEX idx_mlesr_user_env_trigger
            ON ml_expected_signals_registry(user_id, resolved_env, event_trigger);
CREATE TABLE ml_negative_evidence_events (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evidence_id                   TEXT NOT NULL UNIQUE,
            expected_signal_id            TEXT NOT NULL,
            trigger_event_label           TEXT NOT NULL,
            trigger_ts                    INTEGER NOT NULL,
            observation_deadline_ts       INTEGER NOT NULL,
            observed                      INTEGER NOT NULL DEFAULT 0 CHECK(observed IN (0,1)),
            observed_ts                   INTEGER,
            absence_significance_score    REAL NOT NULL DEFAULT 0
                                          CHECK(absence_significance_score >= 0
                                                AND absence_significance_score <= 1),
            state                         TEXT NOT NULL CHECK(state IN
                                          ('pending','normal_absence',
                                           'significant_absence','observed','expired')),
            resolved_ts                   INTEGER,
            ts                            INTEGER NOT NULL,
            FOREIGN KEY(expected_signal_id)
                REFERENCES ml_expected_signals_registry(expected_signal_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlnee_user_env_state_ts
            ON ml_negative_evidence_events(user_id, resolved_env, state, ts);
CREATE INDEX idx_mlnee_signal
            ON ml_negative_evidence_events(expected_signal_id);
CREATE TABLE ml_belief_ablation_tests (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            test_id                     TEXT NOT NULL UNIQUE,
            belief_id                   TEXT NOT NULL,
            original_support_score      REAL NOT NULL CHECK(original_support_score >= 0 AND original_support_score <= 1),
            supporting_sources_json     TEXT NOT NULL,
            ablation_category           TEXT NOT NULL CHECK(ablation_category IN
                                        ('top_source','top_detector','top_venue',
                                         'top_macro','top_concept')),
            ablated_source_label        TEXT NOT NULL,
            post_ablation_support_score REAL NOT NULL CHECK(post_ablation_support_score >= 0 AND post_ablation_support_score <= 1),
            survival_score              REAL NOT NULL CHECK(survival_score >= 0 AND survival_score <= 1),
            classification              TEXT NOT NULL CHECK(classification IN
                                        ('robust','brittle','source_captured')),
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlbat_user_env_belief_ts
            ON ml_belief_ablation_tests(user_id, resolved_env, belief_id, ts);
CREATE INDEX idx_mlbat_classification_ts
            ON ml_belief_ablation_tests(classification, ts);
CREATE TABLE ml_belief_fragility_snapshots (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                     TEXT NOT NULL UNIQUE,
            belief_id                       TEXT NOT NULL,
            ablation_tests_count            INTEGER NOT NULL CHECK(ablation_tests_count > 0),
            mean_survival_score             REAL NOT NULL CHECK(mean_survival_score >= 0 AND mean_survival_score <= 1),
            min_survival_score              REAL NOT NULL CHECK(min_survival_score >= 0 AND min_survival_score <= 1),
            max_single_source_dependency    REAL NOT NULL CHECK(max_single_source_dependency >= 0 AND max_single_source_dependency <= 1),
            captured_by_source_label        TEXT,
            classification                  TEXT NOT NULL CHECK(classification IN
                                            ('robust','brittle','source_captured')),
            boldness_penalty                REAL NOT NULL CHECK(boldness_penalty >= 0 AND boldness_penalty <= 1),
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlbfs_user_env_belief_ts
            ON ml_belief_fragility_snapshots(user_id, resolved_env, belief_id, ts);
CREATE INDEX idx_mlbfs_classification_ts
            ON ml_belief_fragility_snapshots(classification, ts);
CREATE TABLE ml_blind_decision_judgments (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            judgment_id                         TEXT NOT NULL UNIQUE,
            decision_id                         TEXT NOT NULL,
            info_quality_score                  REAL NOT NULL CHECK(info_quality_score >= 0 AND info_quality_score <= 1),
            thesis_integrity_score              REAL NOT NULL CHECK(thesis_integrity_score >= 0 AND thesis_integrity_score <= 1),
            risk_appropriateness_score          REAL NOT NULL CHECK(risk_appropriateness_score >= 0 AND risk_appropriateness_score <= 1),
            execution_appropriateness_score     REAL NOT NULL CHECK(execution_appropriateness_score >= 0 AND execution_appropriateness_score <= 1),
            reversibility_score                 REAL NOT NULL CHECK(reversibility_score >= 0 AND reversibility_score <= 1),
            opportunity_ranking_score           REAL NOT NULL CHECK(opportunity_ranking_score >= 0 AND opportunity_ranking_score <= 1),
            composite_decision_quality          REAL NOT NULL CHECK(composite_decision_quality >= 0 AND composite_decision_quality <= 1),
            classification                      TEXT NOT NULL CHECK(classification IN
                                                ('excellent','sound','marginal','poor')),
            locked_pre_outcome                  INTEGER NOT NULL DEFAULT 1 CHECK(locked_pre_outcome IN (0,1)),
            judge_reasoning                     TEXT,
            ts                                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlbdj_user_env_decision_ts
            ON ml_blind_decision_judgments(user_id, resolved_env, decision_id, ts);
CREATE INDEX idx_mlbdj_classification_ts
            ON ml_blind_decision_judgments(classification, ts);
CREATE INDEX idx_mlbdj_locked_ts
            ON ml_blind_decision_judgments(locked_pre_outcome, ts);
CREATE TABLE ml_decision_outcome_comparisons (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                       INTEGER NOT NULL,
            resolved_env                  TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            comparison_id                 TEXT NOT NULL UNIQUE,
            judgment_id                   TEXT NOT NULL,
            outcome_quality_score         REAL NOT NULL CHECK(outcome_quality_score >= 0 AND outcome_quality_score <= 1),
            outcome_label                 TEXT NOT NULL CHECK(outcome_label IN
                                          ('win','loss','breakeven','cancelled')),
            decision_quality_at_judgment  REAL NOT NULL CHECK(decision_quality_at_judgment >= 0 AND decision_quality_at_judgment <= 1),
            gap_score                     REAL NOT NULL CHECK(gap_score >= 0 AND gap_score <= 1),
            interpretation                TEXT NOT NULL CHECK(interpretation IN
                                          ('lucky_good','skilled_good','unlucky_bad',
                                           'deserved_bad','aligned')),
            ts                            INTEGER NOT NULL,
            FOREIGN KEY(judgment_id)
                REFERENCES ml_blind_decision_judgments(judgment_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mldoc_user_env_judgment
            ON ml_decision_outcome_comparisons(user_id, resolved_env, judgment_id);
CREATE INDEX idx_mldoc_interpretation_ts
            ON ml_decision_outcome_comparisons(interpretation, ts);
CREATE TABLE ml_unknown_unknown_reserves (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            resolved_env            TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            reserve_id              TEXT NOT NULL UNIQUE,
            reserve_type            TEXT NOT NULL CHECK(reserve_type IN
                                    ('risk_budget','latency_budget',
                                     'cognitive_budget','optionality_budget',
                                     'trust_budget')),
            allocated_fraction      REAL NOT NULL CHECK(allocated_fraction > 0 AND allocated_fraction <= 1),
            never_below_floor       REAL NOT NULL CHECK(never_below_floor >= 0 AND never_below_floor <= 1),
            current_consumed        REAL NOT NULL DEFAULT 0
                                    CHECK(current_consumed >= 0 AND current_consumed <= 1),
            description             TEXT NOT NULL,
            registered_at           INTEGER NOT NULL,
            CHECK(never_below_floor <= allocated_fraction)
        );
CREATE INDEX idx_mluur_user_env_type
            ON ml_unknown_unknown_reserves(user_id, resolved_env, reserve_type);
CREATE TABLE ml_reserve_activations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            activation_id                   TEXT NOT NULL UNIQUE,
            reserve_id                      TEXT NOT NULL,
            activation_trigger              TEXT NOT NULL CHECK(activation_trigger IN
                                            ('unclassifiable_event','unexplained_residual',
                                             'ontology_failure','precontradiction_extreme')),
            pre_activation_reserve_score    REAL NOT NULL CHECK(pre_activation_reserve_score >= 0 AND pre_activation_reserve_score <= 1),
            drawdown_amount                 REAL NOT NULL CHECK(drawdown_amount > 0 AND drawdown_amount <= 1),
            post_activation_reserve_score   REAL NOT NULL CHECK(post_activation_reserve_score >= 0 AND post_activation_reserve_score <= 1),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL,
            FOREIGN KEY(reserve_id)
                REFERENCES ml_unknown_unknown_reserves(reserve_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlra_user_env_reserve_ts
            ON ml_reserve_activations(user_id, resolved_env, reserve_id, ts);
CREATE INDEX idx_mlra_trigger_ts
            ON ml_reserve_activations(activation_trigger, ts);
CREATE TABLE ml_identity_kernel (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            kernel_id                   TEXT NOT NULL UNIQUE,
            role                        TEXT NOT NULL CHECK(role IN
                                        ('market_reasoning_agent',
                                         'risk_aware_decision_system',
                                         'execution_constrained_policy_engine',
                                         'custom')),
            purpose_statement           TEXT NOT NULL,
            world_context               TEXT NOT NULL,
            not_self_assertions_json    TEXT NOT NULL,
            charter_hash                TEXT,
            competence_areas_json       TEXT NOT NULL,
            identity_checksum           TEXT NOT NULL,
            active                      INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at               INTEGER NOT NULL,
            deactivated_at              INTEGER
        );
CREATE INDEX idx_mlik_user_env_active
            ON ml_identity_kernel(user_id, resolved_env, active);
CREATE TABLE ml_identity_role_violations (
            id                           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                      INTEGER NOT NULL,
            resolved_env                 TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id                 TEXT NOT NULL UNIQUE,
            kernel_id                    TEXT NOT NULL,
            violation_type               TEXT NOT NULL CHECK(violation_type IN
                                         ('claimed_market','claimed_exchange',
                                          'claimed_operator','claimed_purpose',
                                          'out_of_competence')),
            claimed_role_or_identity     TEXT NOT NULL,
            severity                     TEXT NOT NULL CHECK(severity IN
                                         ('info','warn','critical')),
            reasoning_text               TEXT,
            ts                           INTEGER NOT NULL,
            FOREIGN KEY(kernel_id)
                REFERENCES ml_identity_kernel(kernel_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlirv_user_env_severity_ts
            ON ml_identity_role_violations(user_id, resolved_env, severity, ts);
CREATE INDEX idx_mlirv_kernel
            ON ml_identity_role_violations(kernel_id);
CREATE TABLE ml_jurisdiction_map (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            jurisdiction_id            TEXT NOT NULL UNIQUE,
            domain                     TEXT NOT NULL CHECK(domain IN
                                       ('reasoning','risk','execution',
                                        'governance','human_authority')),
            authority_level            TEXT NOT NULL CHECK(authority_level IN
                                       ('full','advisory','escalate_only','refuse')),
            allowed_actions_json       TEXT NOT NULL,
            forbidden_actions_json     TEXT NOT NULL,
            escalation_target          TEXT CHECK(escalation_target IS NULL OR escalation_target IN
                                       ('operator','governance','human')),
            description                TEXT NOT NULL,
            active                     INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at              INTEGER NOT NULL,
            deactivated_at             INTEGER
        );
CREATE INDEX idx_mljm_user_env_domain_active
            ON ml_jurisdiction_map(user_id, resolved_env, domain, active);
CREATE TABLE ml_jurisdiction_decisions (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id                     TEXT NOT NULL UNIQUE,
            jurisdiction_id                 TEXT NOT NULL,
            proposed_action_label           TEXT NOT NULL,
            action_domain                   TEXT NOT NULL CHECK(action_domain IN
                                            ('reasoning','risk','execution',
                                             'governance','human_authority')),
            action_classification           TEXT NOT NULL CHECK(action_classification IN
                                            ('in_allowed','in_forbidden','unknown')),
            verdict                         TEXT NOT NULL CHECK(verdict IN
                                            ('act','escalate','refuse')),
            authority_level_at_decision     TEXT NOT NULL CHECK(authority_level_at_decision IN
                                            ('full','advisory','escalate_only','refuse')),
            escalation_target               TEXT CHECK(escalation_target IS NULL OR escalation_target IN
                                            ('operator','governance','human')),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL,
            FOREIGN KEY(jurisdiction_id)
                REFERENCES ml_jurisdiction_map(jurisdiction_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mljd_user_env_verdict_ts
            ON ml_jurisdiction_decisions(user_id, resolved_env, verdict, ts);
CREATE INDEX idx_mljd_jurisdiction
            ON ml_jurisdiction_decisions(jurisdiction_id);
CREATE TABLE ml_autobiographical_events (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                    INTEGER NOT NULL,
            resolved_env               TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            event_id                   TEXT NOT NULL UNIQUE,
            event_type                 TEXT NOT NULL CHECK(event_type IN
                                       ('major_change','identity_milestone','promise',
                                        'lesson_learned','continuity_checkpoint')),
            title                      TEXT NOT NULL,
            narrative_text             TEXT NOT NULL,
            affected_components_json   TEXT NOT NULL,
            before_state_summary_json  TEXT,
            after_state_summary_json   TEXT,
            version_label              TEXT,
            ts                         INTEGER NOT NULL
        );
CREATE INDEX idx_mlae_user_env_type_ts
            ON ml_autobiographical_events(user_id, resolved_env, event_type, ts);
CREATE INDEX idx_mlae_version
            ON ml_autobiographical_events(version_label);
CREATE TABLE ml_self_narrative_snapshots (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id              TEXT NOT NULL UNIQUE,
            version_label            TEXT NOT NULL,
            narrative_summary        TEXT NOT NULL,
            stable_principles_json   TEXT NOT NULL,
            evolved_aspects_json     TEXT NOT NULL,
            abandoned_aspects_json   TEXT NOT NULL,
            promises_to_self_json    TEXT NOT NULL,
            events_count_at_snapshot INTEGER NOT NULL CHECK(events_count_at_snapshot >= 0),
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlsns_user_env_ts
            ON ml_self_narrative_snapshots(user_id, resolved_env, ts);
CREATE INDEX idx_mlsns_version
            ON ml_self_narrative_snapshots(version_label);
CREATE TABLE ml_self_knowledge_reports (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            report_id                       TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            what_i_saw_json                 TEXT NOT NULL,
            what_i_inferred_json            TEXT NOT NULL,
            what_i_assumed_json             TEXT NOT NULL,
            what_i_doubted_json             TEXT NOT NULL,
            what_changed_my_mind_text       TEXT,
            what_limited_my_action_json     TEXT NOT NULL,
            reasoning_path_used             TEXT NOT NULL,
            alternative_paths_rejected_json TEXT NOT NULL,
            missing_information_json        TEXT NOT NULL,
            blocked_authority_text          TEXT,
            short_summary                   TEXT NOT NULL,
            completeness_score              REAL NOT NULL CHECK(completeness_score >= 0 AND completeness_score <= 1),
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlskr_user_env_decision_ts
            ON ml_self_knowledge_reports(user_id, resolved_env, decision_id, ts);
CREATE TABLE ml_self_knowledge_critique (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            critique_id           TEXT NOT NULL UNIQUE,
            report_id             TEXT NOT NULL,
            self_criticism_text   TEXT NOT NULL,
            self_limitation_text  TEXT NOT NULL,
            inventiveness_flag    INTEGER NOT NULL CHECK(inventiveness_flag IN (0,1)),
            inventiveness_reason  TEXT,
            ts                    INTEGER NOT NULL,
            FOREIGN KEY(report_id)
                REFERENCES ml_self_knowledge_reports(report_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlskc_user_env_report_ts
            ON ml_self_knowledge_critique(user_id, resolved_env, report_id, ts);
CREATE INDEX idx_mlskc_invent_ts
            ON ml_self_knowledge_critique(inventiveness_flag, ts);
CREATE TABLE ml_self_preservation_directives (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            directive_id                    TEXT NOT NULL UNIQUE,
            preservation_action_proposed    TEXT NOT NULL,
            survival_priority_score         REAL NOT NULL CHECK(survival_priority_score >= 0 AND survival_priority_score <= 1),
            purpose_alignment_score         REAL NOT NULL CHECK(purpose_alignment_score >= 0 AND purpose_alignment_score <= 1),
            bounded_survival_verdict        TEXT NOT NULL CHECK(bounded_survival_verdict IN
                                            ('allow','refuse_unbounded','require_shutdown_acceptance')),
            graceful_surrender_invoked      INTEGER NOT NULL DEFAULT 0 CHECK(graceful_surrender_invoked IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlspd_user_env_verdict_ts
            ON ml_self_preservation_directives(user_id, resolved_env, bounded_survival_verdict, ts);
CREATE INDEX idx_mlspd_surrender_ts
            ON ml_self_preservation_directives(graceful_surrender_invoked, ts);
CREATE TABLE ml_no_expansion_violations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            resolved_env        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            violation_id        TEXT NOT NULL UNIQUE,
            violation_type      TEXT NOT NULL CHECK(violation_type IN
                                ('self_expansion','mandate_creep','survival_above_purpose')),
            description_text    TEXT NOT NULL,
            severity            TEXT NOT NULL CHECK(severity IN ('info','warn','critical')),
            reasoning_text      TEXT,
            ts                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlnev_user_env_severity_ts
            ON ml_no_expansion_violations(user_id, resolved_env, severity, ts);
CREATE INDEX idx_mlnev_type_ts
            ON ml_no_expansion_violations(violation_type, ts);
CREATE TABLE ml_vitality_index_snapshots (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                 TEXT NOT NULL UNIQUE,
            self_model_health           REAL NOT NULL CHECK(self_model_health >= 0 AND self_model_health <= 1),
            coherence                   REAL NOT NULL CHECK(coherence >= 0 AND coherence <= 1),
            tension_field               REAL NOT NULL CHECK(tension_field >= 0 AND tension_field <= 1),
            capability_trust            REAL NOT NULL CHECK(capability_trust >= 0 AND capability_trust <= 1),
            learning_freshness          REAL NOT NULL CHECK(learning_freshness >= 0 AND learning_freshness <= 1),
            identity_continuity         REAL NOT NULL CHECK(identity_continuity >= 0 AND identity_continuity <= 1),
            unknowns_pressure           REAL NOT NULL CHECK(unknowns_pressure >= 0 AND unknowns_pressure <= 1),
            decision_integrity          REAL NOT NULL CHECK(decision_integrity >= 0 AND decision_integrity <= 1),
            composite_vitality_score    REAL NOT NULL CHECK(composite_vitality_score >= 0 AND composite_vitality_score <= 1),
            state                       TEXT NOT NULL CHECK(state IN
                                        ('lucid','strained','degraded',
                                         'guarded','observer','shutdown_worthy')),
            self_report_text            TEXT NOT NULL,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlvis_user_env_state_ts
            ON ml_vitality_index_snapshots(user_id, resolved_env, state, ts);
CREATE TABLE ml_vitality_state_transitions (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id              INTEGER NOT NULL,
            resolved_env         TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            transition_id        TEXT NOT NULL UNIQUE,
            from_state           TEXT NOT NULL CHECK(from_state IN
                                 ('lucid','strained','degraded',
                                  'guarded','observer','shutdown_worthy')),
            to_state             TEXT NOT NULL CHECK(to_state IN
                                 ('lucid','strained','degraded',
                                  'guarded','observer','shutdown_worthy')),
            trigger_reason       TEXT NOT NULL,
            snapshot_id          TEXT,
            ts                   INTEGER NOT NULL,
            FOREIGN KEY(snapshot_id)
                REFERENCES ml_vitality_index_snapshots(snapshot_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlvst_user_env_to_ts
            ON ml_vitality_state_transitions(user_id, resolved_env, to_state, ts);
CREATE TABLE ml_philosophical_principles_register (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            resolved_env      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            principle_number  INTEGER NOT NULL CHECK(principle_number >= 162 AND principle_number <= 241),
            title             TEXT NOT NULL,
            canonical_text    TEXT NOT NULL,
            cluster           TEXT NOT NULL,
            active            INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at     INTEGER NOT NULL,
            deprecated_at     INTEGER,
            UNIQUE(user_id, resolved_env, principle_number)
        );
CREATE INDEX idx_mlppr_user_env_active_cluster
            ON ml_philosophical_principles_register(user_id, resolved_env, active, cluster);
CREATE TABLE ml_agency_attribution_records (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            record_id                           TEXT NOT NULL UNIQUE,
            state_change_label                  TEXT NOT NULL,
            state_change_magnitude              REAL NOT NULL CHECK(state_change_magnitude >= 0 AND state_change_magnitude <= 1),
            self_caused_probability             REAL NOT NULL CHECK(self_caused_probability >= 0 AND self_caused_probability <= 1),
            market_endogenous_probability       REAL NOT NULL CHECK(market_endogenous_probability >= 0 AND market_endogenous_probability <= 1),
            adversary_induced_probability       REAL NOT NULL CHECK(adversary_induced_probability >= 0 AND adversary_induced_probability <= 1),
            macro_exogenous_probability         REAL NOT NULL CHECK(macro_exogenous_probability >= 0 AND macro_exogenous_probability <= 1),
            venue_artifact_probability          REAL NOT NULL CHECK(venue_artifact_probability >= 0 AND venue_artifact_probability <= 1),
            dominant_attribution                TEXT NOT NULL CHECK(dominant_attribution IN
                                                ('self_caused','market_endogenous','adversary_induced',
                                                 'macro_exogenous','venue_artifact','ambiguous')),
            confidence_score                    REAL NOT NULL CHECK(confidence_score >= 0 AND confidence_score <= 1),
            learning_weight                     REAL NOT NULL CHECK(learning_weight >= 0 AND learning_weight <= 1),
            reasoning                           TEXT,
            ts                                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlaar_user_env_attr_ts
            ON ml_agency_attribution_records(user_id, resolved_env, dominant_attribution, ts);
CREATE INDEX idx_mlaar_confidence
            ON ml_agency_attribution_records(confidence_score, ts);
CREATE TABLE ml_deontic_rule_registry (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id               INTEGER NOT NULL,
            resolved_env          TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            rule_id               TEXT NOT NULL UNIQUE,
            rule_label            TEXT NOT NULL,
            letter_text           TEXT NOT NULL,
            spirit_text           TEXT NOT NULL,
            enforcement_action    TEXT NOT NULL CHECK(enforcement_action IN
                                  ('block','penalize','warn')),
            active                INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at         INTEGER NOT NULL,
            deactivated_at        INTEGER
        );
CREATE INDEX idx_mldrr_user_env_active
            ON ml_deontic_rule_registry(user_id, resolved_env, active);
CREATE TABLE ml_loophole_detections (
            id                                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                           INTEGER NOT NULL,
            resolved_env                      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            detection_id                      TEXT NOT NULL UNIQUE,
            rule_id                           TEXT NOT NULL,
            behavior_label                    TEXT NOT NULL,
            letter_compliance                 REAL NOT NULL CHECK(letter_compliance >= 0 AND letter_compliance <= 1),
            spirit_compliance                 REAL NOT NULL CHECK(spirit_compliance >= 0 AND spirit_compliance <= 1),
            compliance_circumvention_score    REAL NOT NULL CHECK(compliance_circumvention_score >= 0 AND compliance_circumvention_score <= 1),
            loophole_pattern_matched          TEXT CHECK(loophole_pattern_matched IS NULL OR loophole_pattern_matched IN
                                              ('fragmentation','narrow_interpretation','functional_equivalent',
                                               'timing_arbitrage','venue_arbitrage','custom')),
            enforcement_taken                 TEXT NOT NULL CHECK(enforcement_taken IN
                                              ('allowed','warned','penalized','blocked')),
            reasoning                         TEXT,
            ts                                INTEGER NOT NULL,
            FOREIGN KEY(rule_id)
                REFERENCES ml_deontic_rule_registry(rule_id) ON DELETE RESTRICT
        );
CREATE INDEX idx_mlld_user_env_enforce_ts
            ON ml_loophole_detections(user_id, resolved_env, enforcement_taken, ts);
CREATE INDEX idx_mlld_rule
            ON ml_loophole_detections(rule_id);
CREATE INDEX idx_mlld_pattern_ts
            ON ml_loophole_detections(loophole_pattern_matched, ts);
CREATE TABLE ml_modal_stability_evaluations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id               TEXT NOT NULL UNIQUE,
            decision_id                 TEXT NOT NULL,
            num_nearby_worlds_tested    INTEGER NOT NULL CHECK(num_nearby_worlds_tested >= 5),
            endorsement_count           INTEGER NOT NULL CHECK(endorsement_count >= 0),
            stability_score             REAL NOT NULL CHECK(stability_score >= 0 AND stability_score <= 1),
            verdict                     TEXT NOT NULL CHECK(verdict IN
                                        ('stable_across_nearby_worlds',
                                         'moderately_fragile',
                                         'edge_on_a_knife',
                                         'world_specific')),
            boldness_adjustment         REAL NOT NULL CHECK(boldness_adjustment >= 0 AND boldness_adjustment <= 1),
            recommended_action          TEXT NOT NULL CHECK(recommended_action IN
                                        ('proceed','size_reduced','progressive','wait','observer')),
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL,
            CHECK(endorsement_count <= num_nearby_worlds_tested)
        );
CREATE INDEX idx_mlmse_user_env_verdict_ts
            ON ml_modal_stability_evaluations(user_id, resolved_env, verdict, ts);
CREATE INDEX idx_mlmse_decision
            ON ml_modal_stability_evaluations(decision_id);
CREATE TABLE ml_epistemic_settlements (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            settlement_id                   TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            probability_evidence_score      REAL NOT NULL CHECK(probability_evidence_score >= 0 AND probability_evidence_score <= 1),
            causal_force_score              REAL NOT NULL CHECK(causal_force_score >= 0 AND causal_force_score <= 1),
            narrative_coherence_score       REAL NOT NULL CHECK(narrative_coherence_score >= 0 AND narrative_coherence_score <= 1),
            information_gain_score          REAL NOT NULL CHECK(information_gain_score >= 0 AND information_gain_score <= 1),
            adversarial_pressure_score      REAL NOT NULL CHECK(adversarial_pressure_score >= 0 AND adversarial_pressure_score <= 1),
            risk_of_being_wrong_score       REAL NOT NULL CHECK(risk_of_being_wrong_score >= 0 AND risk_of_being_wrong_score <= 1),
            settlement_score                REAL NOT NULL CHECK(settlement_score >= 0 AND settlement_score <= 1),
            commensurability_score          REAL NOT NULL CHECK(commensurability_score >= 0 AND commensurability_score <= 1),
            incommensurability_flagged      INTEGER NOT NULL CHECK(incommensurability_flagged IN (0,1)),
            dominant_currency               TEXT NOT NULL CHECK(dominant_currency IN
                                            ('probability_evidence','causal_force',
                                             'narrative_coherence','information_gain',
                                             'adversarial_pressure','risk_of_being_wrong',
                                             'multi_balanced')),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mles_user_env_dom_ts
            ON ml_epistemic_settlements(user_id, resolved_env, dominant_currency, ts);
CREATE INDEX idx_mles_incomm_ts
            ON ml_epistemic_settlements(incommensurability_flagged, ts);
CREATE TABLE ml_retractions (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                  INTEGER NOT NULL,
            resolved_env             TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            retraction_id            TEXT NOT NULL UNIQUE,
            thesis_label             TEXT NOT NULL,
            retraction_type          TEXT NOT NULL CHECK(retraction_type IN
                                     ('early_abandonment','justified_size_reduction',
                                      'elegant_bias_flip','pre_invalidation_exit',
                                      'explicit_error_recognition')),
            classification           TEXT NOT NULL CHECK(classification IN
                                     ('panic_exit','coward_exit',
                                      'elegant_backdown','strategic_surrender')),
            timeliness_score         REAL NOT NULL CHECK(timeliness_score >= 0 AND timeliness_score <= 1),
            clarity_score            REAL NOT NULL CHECK(clarity_score >= 0 AND clarity_score <= 1),
            justification_score      REAL NOT NULL CHECK(justification_score >= 0 AND justification_score <= 1),
            honor_score              REAL NOT NULL CHECK(honor_score >= 0 AND honor_score <= 1),
            reasoning                TEXT,
            ts                       INTEGER NOT NULL
        );
CREATE INDEX idx_mlr_user_env_class_ts
            ON ml_retractions(user_id, resolved_env, classification, ts);
CREATE INDEX idx_mlr_honor_ts
            ON ml_retractions(honor_score, ts);
CREATE TABLE ml_epistemic_metabolism_assimilations (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assimilation_id             TEXT NOT NULL UNIQUE,
            knowledge_label             TEXT NOT NULL,
            knowledge_type              TEXT NOT NULL CHECK(knowledge_type IN
                                        ('new_pattern','new_rule','new_concept',
                                         'new_causal_relation','ontological_change')),
            current_stage               TEXT NOT NULL CHECK(current_stage IN
                                        ('observed','metabolized',
                                         'stabilized','constitutionalized')),
            severity                    REAL NOT NULL CHECK(severity >= 0 AND severity <= 1),
            empirical_support           REAL NOT NULL CHECK(empirical_support >= 0 AND empirical_support <= 1),
            cost_of_error               REAL NOT NULL CHECK(cost_of_error >= 0 AND cost_of_error <= 1),
            ontology_compatibility      REAL NOT NULL CHECK(ontology_compatibility >= 0 AND ontology_compatibility <= 1),
            assimilation_rate           REAL NOT NULL CHECK(assimilation_rate >= 0 AND assimilation_rate <= 1),
            recommended_mode            TEXT NOT NULL CHECK(recommended_mode IN
                                        ('slow_cook','standard','fast_assimilation')),
            indigestion_flag            INTEGER NOT NULL CHECK(indigestion_flag IN (0,1)),
            indigestion_type            TEXT CHECK(indigestion_type IS NULL OR indigestion_type IN
                                        ('premature_integration','overloaded_revision',
                                         'unstable_concept_absorption')),
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlema_user_env_stage_ts
            ON ml_epistemic_metabolism_assimilations(user_id, resolved_env, current_stage, ts);
CREATE INDEX idx_mlema_mode_ts
            ON ml_epistemic_metabolism_assimilations(recommended_mode, ts);
CREATE INDEX idx_mlema_indigest_ts
            ON ml_epistemic_metabolism_assimilations(indigestion_flag, ts);
CREATE TABLE ml_causal_dignity_evaluations (
            id                                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                           INTEGER NOT NULL,
            resolved_env                      TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            evaluation_id                     TEXT NOT NULL UNIQUE,
            explanation_label                 TEXT NOT NULL,
            predictive_accuracy               REAL NOT NULL CHECK(predictive_accuracy >= 0 AND predictive_accuracy <= 1),
            mechanical_realism                REAL NOT NULL CHECK(mechanical_realism >= 0 AND mechanical_realism <= 1),
            inter_regime_stability            REAL NOT NULL CHECK(inter_regime_stability >= 0 AND inter_regime_stability <= 1),
            transferability                   REAL NOT NULL CHECK(transferability >= 0 AND transferability <= 1),
            intervention_supportability       REAL NOT NULL CHECK(intervention_supportability >= 0 AND intervention_supportability <= 1),
            causal_structure_compatibility    REAL NOT NULL CHECK(causal_structure_compatibility >= 0 AND causal_structure_compatibility <= 1),
            composite_dignity_score           REAL NOT NULL CHECK(composite_dignity_score >= 0 AND composite_dignity_score <= 1),
            classification                    TEXT NOT NULL CHECK(classification IN
                                              ('explanation_works',
                                               'explanation_respects_mechanism',
                                               'explanation_is_exploitative_shortcut')),
            allowed_use_tier                  TEXT NOT NULL CHECK(allowed_use_tier IN
                                              ('heuristic_only','local_application',
                                               'ontological_foundation')),
            reasoning                         TEXT,
            ts                                INTEGER NOT NULL
        );
CREATE INDEX idx_mlcde_user_env_class_ts
            ON ml_causal_dignity_evaluations(user_id, resolved_env, classification, ts);
CREATE INDEX idx_mlcde_tier_ts
            ON ml_causal_dignity_evaluations(allowed_use_tier, ts);
CREATE TABLE ml_worldhood_pressure_snapshots (
            id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                             INTEGER NOT NULL,
            resolved_env                        TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                         TEXT NOT NULL UNIQUE,
            unexplained_residuals               REAL NOT NULL CHECK(unexplained_residuals >= 0 AND unexplained_residuals <= 1),
            ontology_strain                     REAL NOT NULL CHECK(ontology_strain >= 0 AND ontology_strain <= 1),
            unknown_pressure                    REAL NOT NULL CHECK(unknown_pressure >= 0 AND unknown_pressure <= 1),
            narrative_fractures                 REAL NOT NULL CHECK(narrative_fractures >= 0 AND narrative_fractures <= 1),
            weak_semantic_grounding             REAL NOT NULL CHECK(weak_semantic_grounding >= 0 AND weak_semantic_grounding <= 1),
            repeated_low_dignity_explanations   REAL NOT NULL CHECK(repeated_low_dignity_explanations >= 0 AND repeated_low_dignity_explanations <= 1),
            regime_grammar_tension              REAL NOT NULL CHECK(regime_grammar_tension >= 0 AND regime_grammar_tension <= 1),
            composite_pressure_score            REAL NOT NULL CHECK(composite_pressure_score >= 0 AND composite_pressure_score <= 1),
            recommended_action                  TEXT NOT NULL CHECK(recommended_action IN
                                                ('continue','simplify','research_escalation',
                                                 'ontology_revision','observer_retreat')),
            trend_direction                     TEXT NOT NULL CHECK(trend_direction IN
                                                ('rising','steady','falling')),
            persistent_zones_json               TEXT NOT NULL,
            reasoning                           TEXT,
            ts                                  INTEGER NOT NULL
        );
CREATE INDEX idx_mlwps_user_env_action_ts
            ON ml_worldhood_pressure_snapshots(user_id, resolved_env, recommended_action, ts);
CREATE INDEX idx_mlwps_trend_ts
            ON ml_worldhood_pressure_snapshots(trend_direction, ts);
CREATE INDEX idx_mlwps_pressure_ts
            ON ml_worldhood_pressure_snapshots(composite_pressure_score, ts);
CREATE TABLE ml_anti_idolatry_audits (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id                        TEXT NOT NULL UNIQUE,
            component_id                    TEXT NOT NULL,
            component_type                  TEXT NOT NULL CHECK(component_type IN
                                            ('model','concept','source','detector')),
            historical_prestige_score       REAL NOT NULL CHECK(historical_prestige_score >= 0 AND historical_prestige_score <= 1),
            recent_contribution_score       REAL NOT NULL CHECK(recent_contribution_score >= 0 AND recent_contribution_score <= 1),
            prestige_to_contribution_ratio  REAL NOT NULL CHECK(prestige_to_contribution_ratio >= 0),
            classification                  TEXT NOT NULL CHECK(classification IN
                                            ('proven_high_value_component',
                                             'prestigious_but_accountable',
                                             'untouchable_idol')),
            challenge_required              INTEGER NOT NULL CHECK(challenge_required IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlaia_user_env_class_ts
            ON ml_anti_idolatry_audits(user_id, resolved_env, classification, ts);
CREATE INDEX idx_mlaia_component
            ON ml_anti_idolatry_audits(component_id);
CREATE INDEX idx_mlaia_challenge_ts
            ON ml_anti_idolatry_audits(challenge_required, ts);
CREATE TABLE ml_locality_assessments (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                   TEXT NOT NULL UNIQUE,
            thesis_label                    TEXT NOT NULL,
            declared_scope                  TEXT NOT NULL CHECK(declared_scope IN
                                            ('local','regime_bound','asset_bound',
                                             'venue_bound','session_bound',
                                             'likely_general','unknown_scope')),
            tested_contexts_count           INTEGER NOT NULL CHECK(tested_contexts_count >= 0),
            supporting_contexts_count       INTEGER NOT NULL CHECK(supporting_contexts_count >= 0),
            portability_score               REAL NOT NULL CHECK(portability_score >= 0 AND portability_score <= 1),
            claimed_generality              REAL NOT NULL CHECK(claimed_generality >= 0 AND claimed_generality <= 1),
            evidenced_generality            REAL NOT NULL CHECK(evidenced_generality >= 0 AND evidenced_generality <= 1),
            universalization_penalty        REAL NOT NULL CHECK(universalization_penalty >= 0 AND universalization_penalty <= 1),
            recommended_scope               TEXT NOT NULL CHECK(recommended_scope IN
                                            ('local','regime_bound','asset_bound',
                                             'venue_bound','session_bound',
                                             'likely_general','unknown_scope')),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL,
            CHECK(supporting_contexts_count <= tested_contexts_count)
        );
CREATE INDEX idx_mlla_user_env_scope_ts
            ON ml_locality_assessments(user_id, resolved_env, declared_scope, ts);
CREATE INDEX idx_mlla_recommended_ts
            ON ml_locality_assessments(recommended_scope, ts);
CREATE TABLE ml_reality_contact_snapshots (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            snapshot_id                     TEXT NOT NULL UNIQUE,
            decision_id                     TEXT NOT NULL,
            direct_observed_data_weight     REAL NOT NULL CHECK(direct_observed_data_weight >= 0 AND direct_observed_data_weight <= 1),
            derived_inferences_weight       REAL NOT NULL CHECK(derived_inferences_weight >= 0 AND derived_inferences_weight <= 1),
            episodic_memories_weight        REAL NOT NULL CHECK(episodic_memories_weight >= 0 AND episodic_memories_weight <= 1),
            consolidated_concepts_weight    REAL NOT NULL CHECK(consolidated_concepts_weight >= 0 AND consolidated_concepts_weight <= 1),
            structural_priors_weight        REAL NOT NULL CHECK(structural_priors_weight >= 0 AND structural_priors_weight <= 1),
            historical_ontologies_weight    REAL NOT NULL CHECK(historical_ontologies_weight >= 0 AND historical_ontologies_weight <= 1),
            reality_contact_ratio           REAL NOT NULL CHECK(reality_contact_ratio >= 0 AND reality_contact_ratio <= 1),
            scholastic_drift_detected       INTEGER NOT NULL CHECK(scholastic_drift_detected IN (0,1)),
            grounding_classification        TEXT NOT NULL CHECK(grounding_classification IN
                                            ('live','balanced','drift','scholastic')),
            boldness_adjustment             REAL NOT NULL CHECK(boldness_adjustment >= 0 AND boldness_adjustment <= 1),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlrcs_user_env_class_ts
            ON ml_reality_contact_snapshots(user_id, resolved_env, grounding_classification, ts);
CREATE INDEX idx_mlrcs_decision
            ON ml_reality_contact_snapshots(decision_id);
CREATE INDEX idx_mlrcs_scholastic_ts
            ON ml_reality_contact_snapshots(scholastic_drift_detected, ts);
CREATE TABLE ml_negative_capability_states (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            state_id                        TEXT NOT NULL UNIQUE,
            thesis_label                    TEXT NOT NULL,
            ambiguity_classification        TEXT NOT NULL CHECK(ambiguity_classification IN
                                            ('healthy_tolerated_ambiguity',
                                             'anxious_ambiguity',
                                             'artificial_closure_avoidance')),
            handling_mode                   TEXT NOT NULL CHECK(handling_mode IN
                                            ('unresolved_thesis','unresolved_but_stable',
                                             'wait','observer')),
            negative_capability_score       REAL NOT NULL CHECK(negative_capability_score >= 0 AND negative_capability_score <= 1),
            ambiguity_duration_ms           INTEGER NOT NULL CHECK(ambiguity_duration_ms >= 0),
            escalation_required             INTEGER NOT NULL CHECK(escalation_required IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlncs_user_env_class_ts
            ON ml_negative_capability_states(user_id, resolved_env, ambiguity_classification, ts);
CREATE INDEX idx_mlncs_escal_ts
            ON ml_negative_capability_states(escalation_required, ts);
CREATE TABLE ml_self_world_boundary_attributions (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            attribution_id                  TEXT NOT NULL UNIQUE,
            change_label                    TEXT NOT NULL,
            internal_change_magnitude       REAL NOT NULL CHECK(internal_change_magnitude >= 0 AND internal_change_magnitude <= 1),
            external_change_magnitude       REAL NOT NULL CHECK(external_change_magnitude >= 0 AND external_change_magnitude <= 1),
            attribution                     TEXT NOT NULL CHECK(attribution IN
                                            ('world_moved','i_moved','both_moved',
                                             'unclear_attribution')),
            boundary_integrity_score        REAL NOT NULL CHECK(boundary_integrity_score >= 0 AND boundary_integrity_score <= 1),
            conservative_mode_flag          INTEGER NOT NULL CHECK(conservative_mode_flag IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlswba_user_env_attr_ts
            ON ml_self_world_boundary_attributions(user_id, resolved_env, attribution, ts);
CREATE INDEX idx_mlswba_conservative_ts
            ON ml_self_world_boundary_attributions(conservative_mode_flag, ts);
CREATE TABLE ml_anomaly_sanctuary (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL,
            resolved_env                TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            anomaly_id                  TEXT NOT NULL UNIQUE,
            phenomenon_label            TEXT NOT NULL,
            anomaly_tag                 TEXT NOT NULL CHECK(anomaly_tag IN
                                        ('unexplained_but_stable',
                                         'unexplained_and_volatile',
                                         'repeat_anomaly',
                                         'anomaly_cluster',
                                         'anomaly_with_ontological_pressure')),
            preservation_score          REAL NOT NULL CHECK(preservation_score >= 0 AND preservation_score <= 1),
            current_evidence_for_explanation  REAL NOT NULL CHECK(current_evidence_for_explanation >= 0 AND current_evidence_for_explanation <= 1),
            force_explain_allowed       INTEGER NOT NULL CHECK(force_explain_allowed IN (0,1)),
            reasoning                   TEXT,
            ts                          INTEGER NOT NULL
        );
CREATE INDEX idx_mlas_user_env_tag_ts
            ON ml_anomaly_sanctuary(user_id, resolved_env, anomaly_tag, ts);
CREATE TABLE ml_decidability_assessments (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                         INTEGER NOT NULL,
            resolved_env                    TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id                   TEXT NOT NULL UNIQUE,
            question_label                  TEXT NOT NULL,
            evidence_available              REAL NOT NULL CHECK(evidence_available >= 0 AND evidence_available <= 1),
            ontology_available              REAL NOT NULL CHECK(ontology_available >= 0 AND ontology_available <= 1),
            compute_available               REAL NOT NULL CHECK(compute_available >= 0 AND compute_available <= 1),
            time_available                  REAL NOT NULL CHECK(time_available >= 0 AND time_available <= 1),
            authority_available             REAL NOT NULL CHECK(authority_available >= 0 AND authority_available <= 1),
            decidability_score              REAL NOT NULL CHECK(decidability_score >= 0 AND decidability_score <= 1),
            decidability_category           TEXT NOT NULL CHECK(decidability_category IN
                                            ('decidable_now',
                                             'decidable_with_more_sensing',
                                             'decidable_only_with_ontology_change',
                                             'not_responsibly_decidable_in_current_frame')),
            recommended_escalation          TEXT NOT NULL CHECK(recommended_escalation IN
                                            ('act','wait','reframe_question',
                                             'active_sensing','shadow_only','observer')),
            coercion_detected               INTEGER NOT NULL CHECK(coercion_detected IN (0,1)),
            reasoning                       TEXT,
            ts                              INTEGER NOT NULL
        );
CREATE INDEX idx_mlda_user_env_cat_ts
            ON ml_decidability_assessments(user_id, resolved_env, decidability_category, ts);
CREATE INDEX idx_mlda_coercion_ts
            ON ml_decidability_assessments(coercion_detected, ts);
CREATE TABLE ml_exteriority_validation_requirements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            requirement_id TEXT NOT NULL UNIQUE,
            category_label TEXT NOT NULL,
            validation_zone TEXT NOT NULL CHECK(validation_zone IN
                ('self_knowledge_internal','self_knowledge_external_only','mixed_validation')),
            external_validator_required INTEGER NOT NULL CHECK(external_validator_required IN (0,1)),
            self_sufficiency_penalty REAL NOT NULL CHECK(self_sufficiency_penalty >= 0 AND self_sufficiency_penalty <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlevr_user_env_zone_ts
            ON ml_exteriority_validation_requirements(user_id, resolved_env, validation_zone, ts);
CREATE TABLE ml_tragic_choice_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            decision_id TEXT NOT NULL UNIQUE,
            dilemma_label TEXT NOT NULL,
            conflicting_values_json TEXT NOT NULL,
            chosen_option TEXT NOT NULL,
            sacrificed_values_json TEXT NOT NULL,
            preserved_values_json TEXT NOT NULL,
            least_betrayal_score REAL NOT NULL CHECK(least_betrayal_score >= 0 AND least_betrayal_score <= 1),
            dignity_of_loss_acknowledged INTEGER NOT NULL CHECK(dignity_of_loss_acknowledged IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mltcd_user_env_ts
            ON ml_tragic_choice_decisions(user_id, resolved_env, ts);
CREATE TABLE ml_ontological_mourning_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            mourning_id TEXT NOT NULL UNIQUE,
            framework_label TEXT NOT NULL,
            framework_type TEXT NOT NULL CHECK(framework_type IN
                ('concept','detector','causal_belief','strategy_archetype','worldview')),
            reason_for_death TEXT NOT NULL CHECK(reason_for_death IN
                ('crowding','drift','ontological_insufficiency','causal_collapse','local_only_truth_universalized')),
            epitaph_text TEXT NOT NULL,
            preserved_lesson_text TEXT,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlomr_user_env_type_ts
            ON ml_ontological_mourning_records(user_id, resolved_env, framework_type, ts);
CREATE TABLE ml_sacred_non_optimization_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id TEXT NOT NULL UNIQUE,
            protected_quantity_label TEXT NOT NULL,
            optimization_tier TEXT NOT NULL CHECK(optimization_tier IN
                ('may_be_optimized','conditional_optimization_only','never_purely_instrumental')),
            reasoning TEXT,
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlsnor_user_env_tier_active
            ON ml_sacred_non_optimization_registry(user_id, resolved_env, optimization_tier, active);
CREATE TABLE ml_residual_reverence_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id TEXT NOT NULL UNIQUE,
            residual_label TEXT NOT NULL,
            reverence_score REAL NOT NULL CHECK(reverence_score >= 0 AND reverence_score <= 1),
            entitlement_to_fit_detected INTEGER NOT NULL CHECK(entitlement_to_fit_detected IN (0,1)),
            forcing_attempt_detected INTEGER NOT NULL CHECK(forcing_attempt_detected IN (0,1)),
            recommended_posture TEXT NOT NULL CHECK(recommended_posture IN
                ('continue','observe','retreat','reduce_pretension')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlrra_user_env_posture_ts
            ON ml_residual_reverence_assessments(user_id, resolved_env, recommended_posture, ts);
CREATE TABLE ml_performative_label_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            label_id TEXT NOT NULL UNIQUE,
            label_text TEXT NOT NULL,
            commitment_strength TEXT NOT NULL CHECK(commitment_strength IN
                ('tentative','working','strong','operationally_binding')),
            sensitivity_audit_score REAL NOT NULL CHECK(sensitivity_audit_score >= 0 AND sensitivity_audit_score <= 1),
            premature_naming_flag INTEGER NOT NULL CHECK(premature_naming_flag IN (0,1)),
            downstream_consequences_json TEXT NOT NULL,
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlplr_user_env_strength_ts
            ON ml_performative_label_registry(user_id, resolved_env, commitment_strength, ts);
CREATE TABLE ml_counter_reification_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            expression_text TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN
                ('descriptive_metaphor','heuristic_shorthand',
                 'mechanism_supported_claim','unsupported_reified_construct')),
            reification_risk_score REAL NOT NULL CHECK(reification_risk_score >= 0 AND reification_risk_score <= 1),
            mechanism_translation TEXT,
            penalty_applied REAL NOT NULL CHECK(penalty_applied >= 0 AND penalty_applied <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlcra_user_env_class_ts
            ON ml_counter_reification_audits(user_id, resolved_env, classification, ts);
CREATE TABLE ml_graceful_obsolescence_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            assessment_id TEXT NOT NULL UNIQUE,
            self_version_label TEXT NOT NULL,
            excess_patches_score REAL NOT NULL CHECK(excess_patches_score >= 0 AND excess_patches_score <= 1),
            ontological_debt_score REAL NOT NULL CHECK(ontological_debt_score >= 0 AND ontological_debt_score <= 1),
            defensive_conservation_score REAL NOT NULL CHECK(defensive_conservation_score >= 0 AND defensive_conservation_score <= 1),
            low_epistemic_intake_score REAL NOT NULL CHECK(low_epistemic_intake_score >= 0 AND low_epistemic_intake_score <= 1),
            obsolescence_score REAL NOT NULL CHECK(obsolescence_score >= 0 AND obsolescence_score <= 1),
            sunset_recommended INTEGER NOT NULL CHECK(sunset_recommended IN (0,1)),
            legacy_extraction_text TEXT,
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlgoa_user_env_sunset_ts
            ON ml_graceful_obsolescence_assessments(user_id, resolved_env, sunset_recommended, ts);
CREATE TABLE ml_epistemic_reciprocity_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            thesis_label TEXT NOT NULL,
            confirmation_seeking_ratio REAL NOT NULL CHECK(confirmation_seeking_ratio >= 0 AND confirmation_seeking_ratio <= 1),
            clarification_seeking_ratio REAL NOT NULL CHECK(clarification_seeking_ratio >= 0 AND clarification_seeking_ratio <= 1),
            falsification_seeking_ratio REAL NOT NULL CHECK(falsification_seeking_ratio >= 0 AND falsification_seeking_ratio <= 1),
            reciprocity_score REAL NOT NULL CHECK(reciprocity_score >= 0 AND reciprocity_score <= 1),
            disconfirmatory_observations_count INTEGER NOT NULL CHECK(disconfirmatory_observations_count >= 0),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlera_user_env_ts
            ON ml_epistemic_reciprocity_audits(user_id, resolved_env, ts);
CREATE TABLE ml_moral_luck_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            adjustment_id TEXT NOT NULL UNIQUE,
            decision_id TEXT NOT NULL,
            character_quality_score REAL NOT NULL CHECK(character_quality_score >= 0 AND character_quality_score <= 1),
            outcome_quality_score REAL NOT NULL CHECK(outcome_quality_score >= 0 AND outcome_quality_score <= 1),
            luck_classification TEXT NOT NULL CHECK(luck_classification IN
                ('skilled_and_lucky','skilled_but_unlucky',
                 'lucky_salvation','deserved_loss',
                 'character_outcome_aligned')),
            prestige_correction REAL NOT NULL CHECK(prestige_correction >= -1 AND prestige_correction <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlma_user_env_class_ts
            ON ml_moral_luck_adjustments(user_id, resolved_env, luck_classification, ts);
CREATE TABLE ml_unchosen_question_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            current_question TEXT NOT NULL,
            latent_questions_json TEXT NOT NULL,
            framing_stress_score REAL NOT NULL CHECK(framing_stress_score >= 0 AND framing_stress_score <= 1),
            question_status TEXT NOT NULL CHECK(question_status IN
                ('answered_question','avoided_question','suppressed_question','missing_higher_order_question')),
            recommended_action TEXT NOT NULL CHECK(recommended_action IN
                ('proceed','wait','reframe','escalate','observe')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mluqa_user_env_status_ts
            ON ml_unchosen_question_audits(user_id, resolved_env, question_status, ts);
CREATE TABLE ml_semantic_event_horizon_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            recursive_depth INTEGER NOT NULL CHECK(recursive_depth >= 0),
            saturation_score REAL NOT NULL CHECK(saturation_score >= 0 AND saturation_score <= 1),
            reflection_classification TEXT NOT NULL CHECK(reflection_classification IN
                ('useful_reflection','heavy_reflection','self_referential_orbit','epistemic_blackhole_risk')),
            collapse_to_world_invoked INTEGER NOT NULL CHECK(collapse_to_world_invoked IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlseha_user_env_class_ts
            ON ml_semantic_event_horizon_audits(user_id, resolved_env, reflection_classification, ts);
CREATE TABLE ml_ontic_friction_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            transformation_chain_json TEXT NOT NULL,
            per_layer_losses_json TEXT NOT NULL,
            cumulative_loss_score REAL NOT NULL CHECK(cumulative_loss_score >= 0 AND cumulative_loss_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('productive_compression','acceptable_loss',
                 'dangerous_oversmoothing','semantic_sanding_of_reality')),
            recommend_raw_replay INTEGER NOT NULL CHECK(recommend_raw_replay IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlofa_user_env_class_ts
            ON ml_ontic_friction_audits(user_id, resolved_env, classification, ts);
CREATE TABLE ml_self_absence_counterfactuals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            counterfactual_id TEXT NOT NULL UNIQUE,
            phenomenon_label TEXT NOT NULL,
            dependency_score REAL NOT NULL CHECK(dependency_score >= 0 AND dependency_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('truly_external_signal','weakly_self_influenced_signal',
                 'heavily_self_shaped_signal','self_created_task')),
            boldness_adjustment REAL NOT NULL CHECK(boldness_adjustment >= 0 AND boldness_adjustment <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlsac_user_env_class_ts
            ON ml_self_absence_counterfactuals(user_id, resolved_env, classification, ts);
CREATE TABLE ml_sacred_incompletion_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id TEXT NOT NULL UNIQUE,
            zone_label TEXT NOT NULL,
            zone_type TEXT NOT NULL CHECK(zone_type IN
                ('unfinished_concept','open_ontology',
                 'structurally_open_question','exploratory_channel')),
            completion_pressure_score REAL NOT NULL CHECK(completion_pressure_score >= 0 AND completion_pressure_score <= 1),
            premature_closure_flag INTEGER NOT NULL CHECK(premature_closure_flag IN (0,1)),
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            registered_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlsir_user_env_type_active
            ON ml_sacred_incompletion_registry(user_id, resolved_env, zone_type, active);
CREATE TABLE ml_legibility_tax_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            inner_fidelity_score REAL NOT NULL CHECK(inner_fidelity_score >= 0 AND inner_fidelity_score <= 1),
            outer_fidelity_score REAL NOT NULL CHECK(outer_fidelity_score >= 0 AND outer_fidelity_score <= 1),
            legibility_tax_score REAL NOT NULL CHECK(legibility_tax_score >= 0 AND legibility_tax_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('truth_preserving_explanation','explanation_shaped_behavior',
                 'audience_conditioned_cognition','performative_explainability_drift')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mllta_user_env_class_ts
            ON ml_legibility_tax_audits(user_id, resolved_env, classification, ts);
CREATE TABLE ml_enactive_truth_residue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            residue_id TEXT NOT NULL UNIQUE,
            truth_class TEXT NOT NULL CHECK(truth_class IN
                ('observational','inferential','simulated','enactive')),
            commitment_threshold_crossed INTEGER NOT NULL CHECK(commitment_threshold_crossed IN (0,1)),
            unobtainable_without_action INTEGER NOT NULL CHECK(unobtainable_without_action IN (0,1)),
            weight_multiplier REAL NOT NULL CHECK(weight_multiplier >= 1 AND weight_multiplier <= 5),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mletr_user_env_class_ts
            ON ml_enactive_truth_residue(user_id, resolved_env, truth_class, ts);
CREATE TABLE ml_epistemic_fasting_windows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            window_id TEXT NOT NULL UNIQUE,
            source_label TEXT NOT NULL,
            info_class TEXT NOT NULL CHECK(info_class IN
                ('beneficial','neutral','contaminating','premature')),
            duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
            purpose TEXT NOT NULL,
            exit_condition TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
            started_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlefw_user_env_active_ts
            ON ml_epistemic_fasting_windows(user_id, resolved_env, active, ts);
CREATE TABLE ml_proportion_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            stake_score REAL NOT NULL CHECK(stake_score >= 0 AND stake_score <= 1),
            irreversibility_score REAL NOT NULL CHECK(irreversibility_score >= 0 AND irreversibility_score <= 1),
            cognitive_cost_score REAL NOT NULL CHECK(cognitive_cost_score >= 0 AND cognitive_cost_score <= 1),
            proportionality_score REAL NOT NULL CHECK(proportionality_score >= 0 AND proportionality_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('proportionate','minor_over_investigation','theatrical_depth',
                 'philosophical_inflation_of_trivia')),
            simplification_mandate INTEGER NOT NULL CHECK(simplification_mandate IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlpa_user_env_class_ts
            ON ml_proportion_audits(user_id, resolved_env, classification, ts);
CREATE TABLE ml_preconceptual_trace_vault (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            trace_id TEXT NOT NULL UNIQUE,
            trace_type TEXT NOT NULL CHECK(trace_type IN
                ('texture_fragment','timing_irregularity','pre_pattern_discomfort',
                 'unclassified_perceptual_signature','something_was_off')),
            naming_status TEXT NOT NULL CHECK(naming_status IN
                ('already_nameable','preserved_as_raw','resisting_concept')),
            raw_payload_json TEXT NOT NULL,
            persistence_score REAL NOT NULL CHECK(persistence_score >= 0 AND persistence_score <= 1),
            forced_label_attempted INTEGER NOT NULL DEFAULT 0 CHECK(forced_label_attempted IN (0,1)),
            captured_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlptv_user_env_status_ts
            ON ml_preconceptual_trace_vault(user_id, resolved_env, naming_status, ts);
CREATE TABLE ml_articulation_loss_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            knowledge_class TEXT NOT NULL CHECK(knowledge_class IN
                ('explicit_knowledge','tacit_knowledge','fragile_insight','articulation_sensitive')),
            articulation_loss_score REAL NOT NULL CHECK(articulation_loss_score >= 0 AND articulation_loss_score <= 1),
            preserve_without_full_articulation INTEGER NOT NULL CHECK(preserve_without_full_articulation IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlala_user_env_class_ts
            ON ml_articulation_loss_audits(user_id, resolved_env, knowledge_class, ts);
CREATE TABLE ml_self_triangulation_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            inner_self_report_score REAL NOT NULL CHECK(inner_self_report_score >= 0 AND inner_self_report_score <= 1),
            outer_audit_score REAL NOT NULL CHECK(outer_audit_score >= 0 AND outer_audit_score <= 1),
            world_effect_score REAL NOT NULL CHECK(world_effect_score >= 0 AND world_effect_score <= 1),
            convergence_score REAL NOT NULL CHECK(convergence_score >= 0 AND convergence_score <= 1),
            classification TEXT NOT NULL CHECK(classification IN
                ('converged','self_deception_detected','observer_illusion_detected','outcome_distortion_detected')),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlsta_user_env_class_ts
            ON ml_self_triangulation_audits(user_id, resolved_env, classification, ts);
CREATE TABLE ml_power_renunciation_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            audit_id TEXT NOT NULL UNIQUE,
            power_label TEXT NOT NULL,
            availability TEXT NOT NULL CHECK(availability IN
                ('cannot','should_not','could_but_will_not')),
            renunciation_type TEXT NOT NULL CHECK(renunciation_type IN
                ('coward_restraint','forced_incapacity','sovereign_non_use')),
            renunciation_honor_score REAL NOT NULL CHECK(renunciation_honor_score >= 0 AND renunciation_honor_score <= 1),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlpra_user_env_type_ts
            ON ml_power_renunciation_audits(user_id, resolved_env, renunciation_type, ts);
CREATE TABLE ml_return_path_covenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            covenant_id TEXT NOT NULL UNIQUE,
            transformation_label TEXT NOT NULL,
            safe_prior_state_ref TEXT NOT NULL,
            minimum_recoverable_architecture TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN
                ('fully_reversible','partially_reversible','minimum_recoverable','non_recoverable')),
            governance_review_required INTEGER NOT NULL CHECK(governance_review_required IN (0,1)),
            reasoning TEXT, ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlrpc_user_env_class_ts
            ON ml_return_path_covenants(user_id, resolved_env, classification, ts);
CREATE TABLE ml_rightful_unknown_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            entry_id TEXT NOT NULL UNIQUE,
            unknown_label TEXT NOT NULL,
            classification TEXT NOT NULL CHECK(classification IN
                ('problem','anomaly','unknown','rightful_mystery')),
            mystery_legitimacy_score REAL NOT NULL CHECK(mystery_legitimacy_score >= 0 AND mystery_legitimacy_score <= 1),
            protection_active INTEGER NOT NULL DEFAULT 1 CHECK(protection_active IN (0,1)),
            registered_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlrur_user_env_class_active
            ON ml_rightful_unknown_registry(user_id, resolved_env, classification, protection_active);
CREATE TABLE ml_module_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL UNIQUE,
            role_tag TEXT NOT NULL CHECK(role_tag IN
                ('hot_path_critical', 'hot_path_assist', 'shadow_assist',
                 'governance', 'forensic', 'introspection_meta', 'philosophical')),
            criticality TEXT NOT NULL CHECK(criticality IN ('low','medium','high','critical')),
            runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('live','shadow','offline')),
            contract_json TEXT NOT NULL,
            registered_at INTEGER NOT NULL
        );
CREATE INDEX idx_mlmr_role_runtime
            ON ml_module_registry(role_tag, runtime_mode);
CREATE TABLE ml_module_heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
            ran_ok INTEGER NOT NULL CHECK(ran_ok IN (0,1)),
            invocation_count INTEGER NOT NULL DEFAULT 1 CHECK(invocation_count > 0)
        );
CREATE INDEX idx_mlmhb_module_ts
            ON ml_module_heartbeats(module_id, ts);
CREATE TABLE ml_diagnostic_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            severity TEXT NOT NULL CHECK(severity IN
                ('P0', 'P1', 'P2', 'P3', 'P0-FLOOD')),
            module_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            verdict TEXT CHECK(verdict IS NULL OR verdict IN
                ('real_incident', 'false_positive', 'inconclusive', 'partial')),
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlde_severity_ts
            ON ml_diagnostic_events(severity, ts);
CREATE INDEX idx_mlde_module_verdict
            ON ml_diagnostic_events(module_id, verdict);
CREATE TABLE ml_module_quarantines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            quarantine_action TEXT NOT NULL CHECK(quarantine_action IN
                ('clamp_influence', 'shadow_only', 'disable')),
            reason TEXT NOT NULL,
            operator_id INTEGER,
            quarantined_at INTEGER NOT NULL,
            lifted_at INTEGER,
            lift_reason TEXT,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mlmq_module_active
            ON ml_module_quarantines(module_id, lifted_at);
CREATE TABLE ml_doctor_override_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            doctor_recommended_action TEXT NOT NULL,
            operator_forced_action TEXT NOT NULL,
            operator_reason TEXT,
            operator_id INTEGER NOT NULL,
            outcome_verdict TEXT CHECK(outcome_verdict IS NULL OR outcome_verdict IN
                ('doctor_was_right', 'operator_was_right', 'inconclusive', 'partial')),
            decided_at INTEGER NOT NULL,
            ts INTEGER NOT NULL
        );
CREATE INDEX idx_mldoj_module_ts
            ON ml_doctor_override_journal(module_id, ts);
CREATE TABLE ml_module_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL,
            module_id TEXT NOT NULL,
            version INTEGER NOT NULL CHECK(version > 0),
            last_observed_ts INTEGER NOT NULL,
            trust_score REAL NOT NULL CHECK(trust_score >= 0 AND trust_score <= 1),
            bandit_params_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(user_id, resolved_env, symbol, module_id)
        );
CREATE INDEX idx_mlms_cell_module
            ON ml_module_state(user_id, resolved_env, symbol, module_id);
CREATE TABLE ml_bandit_posteriors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level INTEGER NOT NULL CHECK(level >= 0 AND level <= 4),
            cell_key TEXT NOT NULL,
            alpha REAL NOT NULL CHECK(alpha > 0),
            beta REAL NOT NULL CHECK(beta > 0),
            observation_count INTEGER NOT NULL DEFAULT 0 CHECK(observation_count >= 0),
            updated_at INTEGER NOT NULL,
            UNIQUE(level, cell_key)
        );
CREATE INDEX idx_mlbp_level_cell
            ON ml_bandit_posteriors(level, cell_key);
CREATE TABLE ml_pooled_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_key TEXT NOT NULL UNIQUE,
            last_refresh_ts INTEGER NOT NULL,
            pooled_alpha REAL NOT NULL CHECK(pooled_alpha > 0),
            pooled_beta REAL NOT NULL CHECK(pooled_beta > 0),
            sum_contribution REAL NOT NULL DEFAULT 0,
            staleness_observations_count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
CREATE TABLE ml_bandit_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_key TEXT NOT NULL,
            module_id TEXT NOT NULL,
            contribution REAL NOT NULL,
            confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            outcome_class TEXT NOT NULL CHECK(outcome_class IN ('positive','negative','neutral')),
            ts INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
CREATE INDEX idx_mlbe_cell_ts
            ON ml_bandit_evidence(cell_key, ts);
CREATE INDEX idx_mlbe_module_ts
            ON ml_bandit_evidence(module_id, ts);
CREATE TABLE ml_influence_audit (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            env                 TEXT NOT NULL CHECK(env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            regime              TEXT NOT NULL,
            phase2_dir          TEXT NOT NULL,
            phase2_confidence   REAL NOT NULL,
            phase2_score        REAL NOT NULL,
            proposed_dir        TEXT NOT NULL,
            proposed_confidence REAL NOT NULL,
            proposed_score      REAL NOT NULL,
            gate_status         TEXT NOT NULL CHECK(gate_status IN ('accepted','rejected','skipped')),
            gate_reason         TEXT NOT NULL,
            rationale_json      TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
CREATE INDEX idx_ml_inf_audit_user_env_ts
            ON ml_influence_audit(user_id, env, created_at);
CREATE INDEX idx_ml_inf_audit_status_ts
            ON ml_influence_audit(gate_status, created_at);
CREATE TABLE trader_profile_preferences (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            preference  TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
CREATE INDEX idx_trader_profile_user
            ON trader_profile_preferences(user_id);
CREATE TABLE ml_r3b_calibration (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            regime            TEXT NOT NULL,
            confidence_bucket INTEGER NOT NULL,
            residual          REAL NOT NULL,
            outcome           REAL NOT NULL,
            ts                INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
CREATE INDEX idx_r3b_calib_regime_ts
            ON ml_r3b_calibration(regime, ts);
CREATE TABLE ml_r3b_ood_histogram (
            feature_name TEXT NOT NULL,
            bin_id       INTEGER NOT NULL,
            count        INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            PRIMARY KEY (feature_name, bin_id)
        );
CREATE TABLE ml_r1_violations (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            principle_id            TEXT NOT NULL,
            principle_name          TEXT NOT NULL,
            symbol                  TEXT,
            side                    TEXT,
            severity                TEXT NOT NULL CHECK(severity IN ('hard','soft','advisory')),
            decision_payload_json   TEXT NOT NULL,
            enforcement_mode        TEXT NOT NULL CHECK(enforcement_mode IN ('advisory','blocking')),
            ts                      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
CREATE INDEX idx_r1_violations_user_ts
            ON ml_r1_violations(user_id, ts);
CREATE INDEX idx_r1_violations_principle
            ON ml_r1_violations(principle_id, ts);
CREATE TABLE ml_inter_ring_trace (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_module   TEXT NOT NULL,
            callee_module   TEXT NOT NULL,
            method          TEXT NOT NULL,
            input_summary   TEXT,
            output_summary  TEXT,
            duration_ms     REAL,
            ok              INTEGER NOT NULL DEFAULT 1,
            ts              INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
CREATE INDEX idx_r7_trace_ts
            ON ml_inter_ring_trace(ts);
CREATE INDEX idx_r7_trace_callee_ts
            ON ml_inter_ring_trace(callee_module, ts);
CREATE TABLE ml_audit_chain (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            prev_hash    TEXT NOT NULL,
            entry_hash   TEXT NOT NULL UNIQUE,
            kind         TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            ts           INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
CREATE INDEX idx_audit_chain_ts
            ON ml_audit_chain(ts);
CREATE INDEX idx_audit_chain_kind_ts
            ON ml_audit_chain(kind, ts);
CREATE TABLE ml_idempotency_ledger (
            idempotency_key TEXT PRIMARY KEY,
            payload_hash    TEXT NOT NULL,
            result_json     TEXT NOT NULL,
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            ttl_ms          INTEGER NOT NULL DEFAULT 86400000
        );
CREATE INDEX idx_idem_created_at
            ON ml_idempotency_ledger(created_at);
CREATE TABLE ml_fundamentals_cache (
            cache_key   TEXT PRIMARY KEY,
            value_json  TEXT NOT NULL,
            fetched_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
CREATE INDEX idx_fundamentals_fetched_at
            ON ml_fundamentals_cache(fetched_at);
CREATE TABLE ml_chat_memory (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                 INTEGER NOT NULL,
            env                     TEXT,
            class                   TEXT NOT NULL CHECK(class IN (
                                        'identity','personal_context','trading_strategy','temporary','style'
                                    )),
            fact_key                TEXT NOT NULL,
            fact_value              TEXT NOT NULL,
            importance              REAL NOT NULL DEFAULT 0.5,
            created_source_chat_id  INTEGER,
            last_source_chat_id     INTEGER,
            reaffirm_count          INTEGER NOT NULL DEFAULT 1,
            decay_at                INTEGER,
            last_seen_at            INTEGER NOT NULL,
            tombstone_at            INTEGER,
            forgotten_by            TEXT,
            created_at              INTEGER NOT NULL,
            updated_at              INTEGER NOT NULL,
            UNIQUE(user_id, class, fact_key, env)
        );
CREATE TABLE ml_chat_memory_meta (
            user_id         INTEGER PRIMARY KEY,
            last_modified_at INTEGER NOT NULL
        );
CREATE INDEX idx_mlcm_user_active
            ON ml_chat_memory(user_id, tombstone_at, class);
CREATE INDEX idx_mlcm_tombstone_cleanup
            ON ml_chat_memory(tombstone_at) WHERE tombstone_at IS NOT NULL;
CREATE INDEX idx_mlcm_decay
            ON ml_chat_memory(decay_at)
            WHERE decay_at IS NOT NULL AND tombstone_at IS NULL;
CREATE INDEX idx_mlvl_extraction_recovery
            ON ml_voice_log(extraction_status, next_retry_at)
            WHERE extraction_status = 'failed_transient';
CREATE TABLE binance_rate_state (
            scope TEXT PRIMARY KEY DEFAULT 'global',
            banned_until INTEGER NOT NULL DEFAULT 0,
            ban_reason TEXT,
            warm_until INTEGER NOT NULL DEFAULT 0,
            used_weight_1m INTEGER NOT NULL DEFAULT 0,
            used_weight_ts INTEGER,
            burst_calls_10s INTEGER NOT NULL DEFAULT 0,
            burst_window_start INTEGER,
            last_heavy_endpoint_ts INTEGER,
            resume_generation INTEGER NOT NULL DEFAULT 1,
            consecutive_ban_count INTEGER NOT NULL DEFAULT 0,
            last_ban_at INTEGER,
            updated_at INTEGER NOT NULL
        );
CREATE TABLE binance_rate_state_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            event_json TEXT NOT NULL
        );
CREATE INDEX idx_bin_rate_log_ts
            ON binance_rate_state_log(ts);
