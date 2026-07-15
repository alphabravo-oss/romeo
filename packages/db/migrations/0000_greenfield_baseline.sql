CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('user', 'group', 'service_account');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('openai-compatible', 'openai-responses-compatible', 'ollama');--> statement-breakpoint
CREATE TYPE "public"."quota_scope_type" AS ENUM('org', 'user', 'workspace', 'provider', 'agent', 'api_key');--> statement-breakpoint
CREATE TYPE "public"."resource_permission" AS ENUM('read', 'write', 'use', 'run');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_tool_approval', 'cancelled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"outcome" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"service_account_id" text,
	"name" text NOT NULL,
	"hashed_token" text NOT NULL,
	"scopes" text[] NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"hashed_refresh_token" text NOT NULL,
	"access_api_key_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"principal_type" "principal_type" NOT NULL,
	"principal_id" text NOT NULL,
	"permission" "resource_permission" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hashed_token" text NOT NULL,
	"scopes" text[] NOT NULL,
	"is_admin" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_password_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"failed_attempt_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_mfa_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_models" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_model_id" text NOT NULL,
	"system_prompt" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"memory_policy" jsonb DEFAULT '{"mode":"disabled"}'::jsonb NOT NULL,
	"safety_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_profile_id" text,
	"published_version_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tool_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"base_model_id" text NOT NULL,
	"system_prompt" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"memory_policy" jsonb DEFAULT '{"mode":"disabled"}'::jsonb NOT NULL,
	"safety_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_profile_id" text,
	"knowledge_base_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"quota_templates" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"external_customer_id" text,
	"external_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"mentioned_user_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"legal_hold_until" timestamp with time zone,
	"legal_hold_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_tag_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"tags" text[] NOT NULL,
	"visibility" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_folder_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"meta" jsonb,
	"data" jsonb,
	"is_expanded" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_connector_syncs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"source_ids" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"sync_interval_minutes" integer,
	"next_sync_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delegated_oauth_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"connector_type" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_account_login" text,
	"scopes" jsonb NOT NULL,
	"status" text NOT NULL,
	"token" jsonb NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"suite_id" text NOT NULL,
	"input" text NOT NULL,
	"expected_contains" text,
	"rubric" jsonb,
	"requires_citation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_result_human_ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"result_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_run_results" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"status" text NOT NULL,
	"score" real NOT NULL,
	"output" text NOT NULL,
	"checks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"suite_id" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text NOT NULL,
	"score" real NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_suites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"org_id" text PRIMARY KEY NOT NULL,
	"audit_log_retention_days" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_knowledge_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings" (
	"id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"source_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunk_embeddings_org_id_id_pk" PRIMARY KEY("org_id","id")
)
PARTITION BY HASH ("org_id");
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p00" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 0);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p01" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 1);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p02" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 2);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p03" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 3);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p04" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 4);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p05" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 5);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p06" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 6);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p07" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 7);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p08" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 8);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p09" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 9);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p10" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 10);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p11" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 11);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p12" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 12);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p13" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 13);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p14" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 14);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings_p15" PARTITION OF "knowledge_chunk_embeddings" FOR VALUES WITH (MODULUS 16, REMAINDER 15);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"source_id" text NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text NOT NULL,
	"object_key" text,
	"chunk_count" integer,
	"content_hash" text,
	"indexed_at" timestamp with time zone,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"notification_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collaboration_channel_members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text,
	"status" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_channel_muted" boolean DEFAULT false NOT NULL,
	"is_channel_pinned" boolean DEFAULT false NOT NULL,
	"data" jsonb,
	"meta" jsonb,
	"invited_at" timestamp with time zone,
	"invited_by" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collaboration_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text,
	"name" text NOT NULL,
	"description" text,
	"is_private" boolean,
	"data" jsonb,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"archived_at" timestamp with time zone,
	"archived_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "base_models" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"context_window" integer NOT NULL,
	"pricing" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_capabilities" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"capabilities" jsonb NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"secret_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" "provider_kind" NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"credential_ref" text,
	"capabilities" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scope_type" "quota_scope_type" NOT NULL,
	"scope_id" text NOT NULL,
	"metric" text NOT NULL,
	"limit_value" integer NOT NULL,
	"used" integer NOT NULL,
	"reset_interval" text DEFAULT 'none' NOT NULL,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" "run_status" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"status" text NOT NULL,
	"risk_level" text NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"input_keys" text[] NOT NULL,
	"output_keys" text[] NOT NULL,
	"error_code" text,
	"run_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_sso_oidc_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer_url" text DEFAULT '' NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"group_claim" text DEFAULT 'groups' NOT NULL,
	"admin_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workspace_group_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workspace_group_prefix" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"schema" jsonb NOT NULL,
	"auth_config" jsonb NOT NULL,
	"network_policy" jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"approval_policy" text NOT NULL,
	"visibility" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"approval_policy" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text,
	"actor_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"metric" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"org_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_scope_unique" UNIQUE("scope")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_voice_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"style_tags" text[] NOT NULL,
	"cloning_allowed" boolean NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" NOT NULL,
	"attempt_count" integer NOT NULL,
	"response_status" integer,
	"error_code" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"schedule" jsonb,
	"next_scheduled_run_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"current_step_id" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authorizations" ADD CONSTRAINT "device_authorizations_access_api_key_id_api_keys_id_fk" FOREIGN KEY ("access_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_password_credentials" ADD CONSTRAINT "local_password_credentials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_password_credentials" ADD CONSTRAINT "local_password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_mfa_factors" ADD CONSTRAINT "local_mfa_factors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_mfa_factors" ADD CONSTRAINT "local_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_models" ADD CONSTRAINT "agent_models_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_models" ADD CONSTRAINT "agent_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_models" ADD CONSTRAINT "agent_models_base_model_id_base_models_id_fk" FOREIGN KEY ("base_model_id") REFERENCES "public"."base_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_models" ADD CONSTRAINT "agent_models_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_models" ADD CONSTRAINT "agent_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_bindings" ADD CONSTRAINT "agent_tool_bindings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_bindings" ADD CONSTRAINT "agent_tool_bindings_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_base_model_id_base_models_id_fk" FOREIGN KEY ("base_model_id") REFERENCES "public"."base_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_plans" ADD CONSTRAINT "billing_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_comments" ADD CONSTRAINT "chat_comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_comments" ADD CONSTRAINT "chat_comments_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tags" ADD CONSTRAINT "chat_tags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tags" ADD CONSTRAINT "chat_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tag_assignments" ADD CONSTRAINT "chat_tag_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tag_assignments" ADD CONSTRAINT "chat_tag_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tag_assignments" ADD CONSTRAINT "chat_tag_assignments_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tag_assignments" ADD CONSTRAINT "chat_tag_assignments_tag_id_chat_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."chat_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_parts" ADD CONSTRAINT "message_parts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_favorites" ADD CONSTRAINT "resource_favorites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_favorites" ADD CONSTRAINT "resource_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_folder_items" ADD CONSTRAINT "workspace_folder_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_folder_items" ADD CONSTRAINT "workspace_folder_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_folder_items" ADD CONSTRAINT "workspace_folder_items_folder_id_workspace_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."workspace_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_folders" ADD CONSTRAINT "workspace_folders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_folders" ADD CONSTRAINT "workspace_folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_folders" ADD CONSTRAINT "workspace_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connector_syncs" ADD CONSTRAINT "data_connector_syncs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connector_syncs" ADD CONSTRAINT "data_connector_syncs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connector_syncs" ADD CONSTRAINT "data_connector_syncs_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connector_syncs" ADD CONSTRAINT "data_connector_syncs_connector_id_data_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."data_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connector_syncs" ADD CONSTRAINT "data_connector_syncs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connectors" ADD CONSTRAINT "data_connectors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connectors" ADD CONSTRAINT "data_connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connectors" ADD CONSTRAINT "data_connectors_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connectors" ADD CONSTRAINT "data_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_oauth_connections" ADD CONSTRAINT "delegated_oauth_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_oauth_connections" ADD CONSTRAINT "delegated_oauth_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_oauth_connections" ADD CONSTRAINT "delegated_oauth_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_result_human_ratings" ADD CONSTRAINT "eval_result_human_ratings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_result_human_ratings" ADD CONSTRAINT "eval_result_human_ratings_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_result_human_ratings" ADD CONSTRAINT "eval_result_human_ratings_result_id_eval_run_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."eval_run_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_result_human_ratings" ADD CONSTRAINT "eval_result_human_ratings_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_model_id_base_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."base_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bindings" ADD CONSTRAINT "agent_knowledge_bindings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bindings" ADD CONSTRAINT "agent_knowledge_bindings_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bindings" ADD CONSTRAINT "agent_kb_bindings_kb_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "kb_chunk_embeddings_kb_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."user_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_delivery_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_channels" ADD CONSTRAINT "notification_delivery_channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_channels" ADD CONSTRAINT "notification_delivery_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_records" ADD CONSTRAINT "object_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_records" ADD CONSTRAINT "object_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channel_members" ADD CONSTRAINT "collaboration_channel_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channel_members" ADD CONSTRAINT "collaboration_channel_members_channel_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."collaboration_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channel_members" ADD CONSTRAINT "collaboration_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channel_members" ADD CONSTRAINT "collaboration_channel_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channels" ADD CONSTRAINT "collaboration_channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channels" ADD CONSTRAINT "collaboration_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_channels" ADD CONSTRAINT "collaboration_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_models" ADD CONSTRAINT "base_models_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_models" ADD CONSTRAINT "base_models_provider_id_provider_instances_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_provider_id_provider_instances_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_provider_id_provider_instances_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_instances" ADD CONSTRAINT "provider_instances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_buckets" ADD CONSTRAINT "quota_buckets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_model_id_base_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."base_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_provider_id_provider_instances_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_agent_id_agent_models_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_sso_oidc_settings" ADD CONSTRAINT "org_sso_oidc_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connectors" ADD CONSTRAINT "tool_connectors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_operations" ADD CONSTRAINT "tool_operations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_operations" ADD CONSTRAINT "tool_operations_connector_id_tool_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tool_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("org_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("org_id","actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_keys_service_account_idx" ON "api_keys" USING btree ("org_id","service_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_authorizations_refresh_hash_idx" ON "device_authorizations" USING btree ("hashed_refresh_token");--> statement-breakpoint
CREATE INDEX "device_authorizations_user_idx" ON "device_authorizations" USING btree ("org_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "resource_grant_lookup_idx" ON "resource_grants" USING btree ("org_id","resource_type","resource_id","permission");--> statement-breakpoint
CREATE INDEX "resource_grant_principal_idx" ON "resource_grants" USING btree ("org_id","principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_grant_unique_idx" ON "resource_grants" USING btree ("org_id","resource_type","resource_id","principal_type","principal_id","permission");--> statement-breakpoint
CREATE INDEX "service_accounts_org_idx" ON "service_accounts" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_hash_idx" ON "user_sessions" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "local_password_credentials_user_idx" ON "local_password_credentials" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_password_credentials_email_idx" ON "local_password_credentials" USING btree ("org_id","email_normalized");--> statement-breakpoint
CREATE INDEX "local_mfa_factors_user_status_idx" ON "local_mfa_factors" USING btree ("org_id","user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "local_mfa_factors_user_type_idx" ON "local_mfa_factors" USING btree ("org_id","user_id","type");--> statement-breakpoint
CREATE INDEX "agent_models_workspace_idx" ON "agent_models" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_models_workspace_slug_idx" ON "agent_models" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_bindings_agent_tool_unique_idx" ON "agent_tool_bindings" USING btree ("agent_id","tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_version_idx" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_plan_org_idx" ON "billing_plans" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "billing_plans_external_customer_idx" ON "billing_plans" USING btree ("external_customer_id");--> statement-breakpoint
CREATE INDEX "billing_plans_external_subscription_idx" ON "billing_plans" USING btree ("external_subscription_id");--> statement-breakpoint
CREATE INDEX "chat_comment_chat_idx" ON "chat_comments" USING btree ("org_id","chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chats_workspace_updated_idx" ON "chats" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tags_user_slug_idx" ON "chat_tags" USING btree ("org_id","user_id","slug");--> statement-breakpoint
CREATE INDEX "chat_tags_user_name_idx" ON "chat_tags" USING btree ("org_id","user_id","name");--> statement-breakpoint
CREATE INDEX "chat_tag_assignments_chat_idx" ON "chat_tag_assignments" USING btree ("org_id","user_id","chat_id");--> statement-breakpoint
CREATE INDEX "chat_tag_assignments_tag_idx" ON "chat_tag_assignments" USING btree ("org_id","user_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tag_assignments_unique_idx" ON "chat_tag_assignments" USING btree ("org_id","user_id","chat_id","tag_id");--> statement-breakpoint
CREATE INDEX "message_parts_message_position_idx" ON "message_parts" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "messages_chat_created_idx" ON "messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "prompt_template_workspace_idx" ON "prompt_templates" USING btree ("org_id","workspace_id","visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_template_workspace_name_idx" ON "prompt_templates" USING btree ("org_id","workspace_id","name");--> statement-breakpoint
CREATE INDEX "resource_favorite_lookup_idx" ON "resource_favorites" USING btree ("org_id","user_id","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_favorite_unique_idx" ON "resource_favorites" USING btree ("org_id","user_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "workspace_folder_item_folder_idx" ON "workspace_folder_items" USING btree ("org_id","folder_id");--> statement-breakpoint
CREATE INDEX "workspace_folder_item_resource_idx" ON "workspace_folder_items" USING btree ("org_id","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_folder_item_unique_idx" ON "workspace_folder_items" USING btree ("folder_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "workspace_folder_workspace_idx" ON "workspace_folders" USING btree ("org_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_folder_name_idx" ON "workspace_folders" USING btree ("org_id","workspace_id","name");--> statement-breakpoint
CREATE INDEX "data_connector_syncs_org_started_idx" ON "data_connector_syncs" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "data_connector_syncs_connector_started_idx" ON "data_connector_syncs" USING btree ("org_id","connector_id","started_at");--> statement-breakpoint
CREATE INDEX "data_connectors_workspace_created_idx" ON "data_connectors" USING btree ("org_id","workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_connectors_workspace_name_idx" ON "data_connectors" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "data_connectors_kb_idx" ON "data_connectors" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "data_connectors_due_sync_idx" ON "data_connectors" USING btree ("status","next_sync_at");--> statement-breakpoint
CREATE INDEX "delegated_oauth_connections_user_updated_idx" ON "delegated_oauth_connections" USING btree ("org_id","workspace_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "delegated_oauth_connections_status_idx" ON "delegated_oauth_connections" USING btree ("org_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delegated_oauth_connections_provider_account_idx" ON "delegated_oauth_connections" USING btree ("org_id","workspace_id","user_id","provider_id","connector_type","provider_account_id");--> statement-breakpoint
CREATE INDEX "eval_cases_suite_idx" ON "eval_cases" USING btree ("suite_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_result_human_rating_reviewer_idx" ON "eval_result_human_ratings" USING btree ("result_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "eval_result_human_ratings_run_updated_idx" ON "eval_result_human_ratings" USING btree ("run_id","updated_at");--> statement-breakpoint
CREATE INDEX "eval_run_results_run_idx" ON "eval_run_results" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_agent_created_idx" ON "eval_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_suite_completed_idx" ON "eval_runs" USING btree ("suite_id","completed_at");--> statement-breakpoint
CREATE INDEX "eval_suites_agent_created_idx" ON "eval_suites" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_knowledge_bindings_agent_kb_unique_idx" ON "agent_knowledge_bindings" USING btree ("agent_id","knowledge_base_id");--> statement-breakpoint
CREATE INDEX "knowledge_bases_workspace_idx" ON "knowledge_bases" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_embeddings_chunk_model_unique_idx" ON "knowledge_chunk_embeddings" USING btree ("org_id","chunk_id","embedding_provider","embedding_model");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embeddings_kb_idx" ON "knowledge_chunk_embeddings" USING btree ("org_id","knowledge_base_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embeddings_vector_hnsw_idx" ON "knowledge_chunk_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_chunks_kb_sequence_idx" ON "knowledge_chunks" USING btree ("knowledge_base_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_source_sequence_idx" ON "knowledge_chunks" USING btree ("source_id","sequence");--> statement-breakpoint
CREATE INDEX "knowledge_sources_kb_updated_idx" ON "knowledge_sources" USING btree ("knowledge_base_id","updated_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_notification_idx" ON "notification_deliveries" USING btree ("org_id","notification_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_user_idx" ON "notification_deliveries" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_status_idx" ON "notification_deliveries" USING btree ("org_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_channel_lookup_idx" ON "notification_delivery_channels" USING btree ("org_id","user_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_channel_user_name_idx" ON "notification_delivery_channels" USING btree ("org_id","user_id","name");--> statement-breakpoint
CREATE INDEX "object_records_workspace_updated_idx" ON "object_records" USING btree ("org_id","workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "object_records_owner_updated_idx" ON "object_records" USING btree ("org_id","owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "object_records_sha256_idx" ON "object_records" USING btree ("org_id","sha256");--> statement-breakpoint
CREATE INDEX "user_notification_lookup_idx" ON "user_notifications" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_notification_unread_idx" ON "user_notifications" USING btree ("org_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "user_notification_resource_idx" ON "user_notifications" USING btree ("org_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "collaboration_channel_members_channel_idx" ON "collaboration_channel_members" USING btree ("org_id","channel_id");--> statement-breakpoint
CREATE INDEX "collaboration_channel_members_user_idx" ON "collaboration_channel_members" USING btree ("org_id","user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "collaboration_channel_members_unique_idx" ON "collaboration_channel_members" USING btree ("org_id","channel_id","user_id");--> statement-breakpoint
CREATE INDEX "collaboration_channels_org_updated_idx" ON "collaboration_channels" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "collaboration_channels_workspace_updated_idx" ON "collaboration_channels" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "collaboration_channels_owner_idx" ON "collaboration_channels" USING btree ("org_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "base_models_org_provider_idx" ON "base_models" USING btree ("org_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "base_models_provider_name_idx" ON "base_models" USING btree ("provider_id","name");--> statement-breakpoint
CREATE INDEX "provider_instances_org_idx" ON "provider_instances" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_instances_org_name_idx" ON "provider_instances" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_bucket_scope_metric_idx" ON "quota_buckets" USING btree ("org_id","scope_type","scope_id","metric");--> statement-breakpoint
CREATE INDEX "quota_buckets_org_metric_idx" ON "quota_buckets" USING btree ("org_id","metric");--> statement-breakpoint
CREATE INDEX "quota_buckets_reset_idx" ON "quota_buckets" USING btree ("org_id","reset_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_event_sequence_idx" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "runs_chat_created_idx" ON "runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_org_created_idx" ON "runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_calls_org_started_idx" ON "tool_calls" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "background_jobs_org_created_idx" ON "background_jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_workspace_created_idx" ON "background_jobs" USING btree ("org_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_status_updated_idx" ON "background_jobs" USING btree ("org_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_org_slug_idx" ON "workspaces" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "tool_connectors_org_updated_idx" ON "tool_connectors" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_connectors_org_name_idx" ON "tool_connectors" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "tool_operations_connector_idx" ON "tool_operations" USING btree ("connector_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_operations_connector_operation_idx" ON "tool_operations" USING btree ("connector_id","operation_id");--> statement-breakpoint
CREATE INDEX "usage_events_org_created_idx" ON "usage_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_created_idx" ON "usage_events" USING btree ("org_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_source_idx" ON "usage_events" USING btree ("org_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "usage_events_metric_created_idx" ON "usage_events" USING btree ("org_id","metric","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_org_slug_idx" ON "groups" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_idx" ON "identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_idx" ON "users" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "voice_profiles_org_created_idx" ON "voice_profiles" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "voice_profiles_enabled_language_idx" ON "voice_profiles" USING btree ("org_id","enabled","language");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_provider_voice_idx" ON "voice_profiles" USING btree ("org_id","provider_id","provider_voice_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_org_created_idx" ON "webhook_deliveries" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_subscription_created_idx" ON "webhook_deliveries" USING btree ("org_id","subscription_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_org_created_idx" ON "webhook_subscriptions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_subscriptions_org_url_idx" ON "webhook_subscriptions" USING btree ("org_id","url");--> statement-breakpoint
CREATE INDEX "workflow_definitions_workspace_updated_idx" ON "workflow_definitions" USING btree ("org_id","workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_workspace_name_idx" ON "workflow_definitions" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "workflow_definitions_due_schedule_idx" ON "workflow_definitions" USING btree ("org_id","enabled","next_scheduled_run_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_created_idx" ON "workflow_runs" USING btree ("org_id","workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_updated_idx" ON "workflow_runs" USING btree ("org_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_workspace_created_idx" ON "workflow_runs" USING btree ("org_id","workspace_id","created_at");
