<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { useReplies } from '@/composables/useReplies';
import { performCommentAction, performFallbackLikeById } from '@/lib/youtubeApi';
import { isSignedIn } from '@/lib/auth';

const props = defineProps<{ commentId: string; initialToken: string }>();
const replies = useReplies();

onMounted(() => {
  void replies.load(props.commentId, props.initialToken);
});

function thread() {
  return replies.get(props.commentId);
}

const busyMap = reactive<Record<string, boolean>>({});
const errorMap = reactive<Record<string, string | null>>({});
const animMap = reactive<Record<string, boolean>>({});
const fallbackMap = reactive<Record<string, string | null>>({});

function adjustLikeCount(current: string, delta: number): string {
  if (/^\d+$/.test(current.trim())) {
    const n = parseInt(current.trim(), 10) + delta;
    return Math.max(0, n).toString();
  }
  return current;
}

async function onLikeReply(r: any) {
  const id = r.id as string;
  if (busyMap[id]) return;
  errorMap[id] = null;
  fallbackMap[id] = null;
  let useFallback = false;
  if (!r.canLike) {
    console.warn('[ytm-comments] reply like blocked — FALLBACK synthetic', `canLike=${r.canLike} isSignedIn=${isSignedIn()} hasLike=${!!r.likeCommand} id=${id.slice(0, 12)}`, r);
    if (!isSignedIn()) {
      errorMap[id] = 'Sign in to YouTube to like — no SAPISID cookie found';
      return;
    }
    useFallback = true;
    fallbackMap[id] = 'FALLBACK: synthetic commentId method';
  }
  const prevLiked = !!r.isLiked;
  const prevCount = r.likeCount as string;
  const cmd = prevLiked ? r.unlikeCommand : r.likeCommand;
  if (!useFallback && !cmd) {
    console.warn('[ytm-comments] reply missing like command — FALLBACK synthetic', r);
    useFallback = true;
    fallbackMap[id] = 'FALLBACK: synthetic commentId method';
  }
  const nextLiked = !prevLiked;
  r.isLiked = nextLiked;
  r.likeCount = adjustLikeCount(prevCount, nextLiked ? 1 : -1);
  animMap[id] = nextLiked;
  setTimeout(() => (animMap[id] = false), 300);
  busyMap[id] = true;
  try {
    if (useFallback) {
      await performFallbackLikeById(id, prevLiked);
    } else {
      await performCommentAction(cmd);
    }
    errorMap[id] = null;
  } catch (e: any) {
    r.isLiked = prevLiked;
    r.likeCount = prevCount;
    fallbackMap[id] = null;
    errorMap[id] = e?.message ?? 'Like failed';
  } finally {
    busyMap[id] = false;
  }
}
</script>

<template>
  <div class="reply-list">
    <div v-if="thread().status === 'loading'" class="state">Loading replies…</div>
    <div v-else-if="thread().status === 'error'" class="state error">
      Couldn't load replies: {{ thread().error }}
    </div>
    <template v-else>
      <div v-for="r in thread().items" :key="r.id" class="reply">
        <img v-if="r.authorAvatar" :src="r.authorAvatar" :alt="r.author" class="avatar" />
        <div class="body">
          <div class="head">
            <span class="author">{{ r.author }}</span>
            <span class="time">{{ r.publishedTime }}</span>
          </div>
          <div class="text">{{ r.body }}</div>
          <div class="meta">
            <button
              type="button"
              class="like-btn"
              :class="{ liked: r.isLiked, busy: busyMap[r.id] }"
              :disabled="!!busyMap[r.id]"
              :title="r.canLike ? (r.isLiked ? 'Unlike' : 'Like') : 'Sign in to like'"
              :aria-pressed="r.isLiked"
              @click="onLikeReply(r)"
            >
              <span class="like-icon" :class="{ anim: animMap[r.id] }">{{ r.isLiked ? '♥' : '♡' }}</span>
              <span>{{ r.likeCount }}</span>
            </button>
            <span v-if="busyMap[r.id]" class="like-busy">…</span>
          </div>
          <div v-if="fallbackMap[r.id]" class="fallback-badge">⚠ {{ fallbackMap[r.id] }}</div>
          <div v-if="errorMap[r.id]" class="like-error" role="alert">⚠ {{ errorMap[r.id] }}</div>
        </div>
      </div>
      <button
        v-if="thread().nextPageToken"
        type="button"
        class="more"
        :disabled="thread().status === 'loadingMore'"
        @click="replies.loadMore(commentId)"
      >
        {{ thread().status === 'loadingMore' ? 'Loading…' : 'Show more replies' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.reply-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0 0 48px;
  border-left: 2px solid rgba(255, 255, 255, 0.05);
  margin-left: 18px;
}
.state {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  padding: 4px 0;
}
.state.error { color: #ff8a8a; }
.reply {
  display: flex;
  gap: 10px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
.body { flex: 1; min-width: 0; }
.head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
}
.author { font-weight: 600; color: #fff; }
.time { color: rgba(255, 255, 255, 0.5); }
.text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.45;
  white-space: pre-wrap;
  margin-top: 2px;
  word-break: break-word;
}
.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 4px;
}
.like-btn {
  appearance: none;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.75);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  transition: background 140ms, color 140ms, transform 140ms, border-color 140ms;
}
.like-btn:hover { background: rgba(255,255,255,0.1); color: #fff; transform: translateY(-1px); }
.like-btn:active { transform: scale(0.97); }
.like-btn.liked { background: rgba(255,59,92,0.15); border-color: rgba(255,59,92,0.35); color: #ff8da1; }
.like-btn.liked:hover { background: rgba(255,59,92,0.22); color: #ffbfd0; }
.like-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.like-icon { display:inline-block; transition: transform 180ms cubic-bezier(0.34,1.56,0.64,1); font-size:12px; }
.like-icon.anim { transform: scale(1.35); }
.like-busy { font-size: 10px; color: rgba(255,255,255,0.5); }
.like-error { margin-top:4px; font-size:10px; color:#ff8a8a; background: rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.18); padding:4px 6px; border-radius:6px; }
.fallback-badge { margin-top:4px; font-size:9px; color:#ffcc00; background: rgba(255,204,0,0.12); border:1px solid rgba(255,204,0,0.3); padding:3px 6px; border-radius:6px; font-weight:600; }
.more {
  align-self: flex-start;
  background: transparent;
  border: 0;
  color: #62b5ff;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 0;
  cursor: pointer;
}
.more:hover:not(:disabled) { text-decoration: underline; }
</style>
