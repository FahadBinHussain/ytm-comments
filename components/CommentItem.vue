<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import ReplyList from './ReplyList.vue';
import type { Comment } from '@/lib/types';
import { performCommentAction } from '@/lib/youtubeApi';
import { isSignedIn } from '@/lib/auth';

const props = defineProps<{ comment: Comment }>();
const expanded = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const isLiked = ref(props.comment.isLiked);
const likeCount = ref(props.comment.likeCount);
const canLike = computed(() => props.comment.canLike);
const likedAnim = ref(false);

watch(() => props.comment.isLiked, (v) => (isLiked.value = v));
watch(() => props.comment.likeCount, (v) => (likeCount.value = v));
watch(() => props.comment.canLike, () => {});

function toggle() {
  expanded.value = !expanded.value;
}

function adjustLikeCount(current: string, delta: number): string {
  const raw = current.trim();
  // try plain number
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10) + delta;
    return Math.max(0, n).toString();
  }
  // try with suffix K/M/B
  const m = raw.match(/^([\d.,]+)([KMB])$/i);
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    const suffix = m[2].toUpperCase();
    // don't try to adjust precisely, keep original if delta would be <1% of magnitude
    // but for optimistic we just keep original and add liked indicator instead
    return raw;
  }
  return raw;
}

async function onLike() {
  if (busy.value) return;
  error.value = null;
  if (!canLike.value) {
    if (!isSignedIn()) {
      error.value = 'Sign in to YouTube to like comments';
    } else {
      error.value = 'Like not available for this comment';
    }
    return;
  }
  const prevLiked = isLiked.value;
  const prevCount = likeCount.value;
  const cmd = prevLiked ? props.comment.unlikeCommand : props.comment.likeCommand;
  if (!cmd) {
    error.value = prevLiked ? 'Unlike action not available — you may be signed out' : 'Like action not available — you may be signed out';
    return;
  }
  // optimistic
  const nextLiked = !prevLiked;
  isLiked.value = nextLiked;
  likeCount.value = adjustLikeCount(prevCount, nextLiked ? 1 : -1);
  // keep source in sync (since parent reactive array holds same object)
  props.comment.isLiked = nextLiked;
  props.comment.likeCount = likeCount.value;
  likedAnim.value = nextLiked;
  setTimeout(() => (likedAnim.value = false), 300);
  busy.value = true;
  try {
    await performCommentAction(cmd);
    error.value = null;
  } catch (e: any) {
    // rollback LOUDLY — no silent fallback
    isLiked.value = prevLiked;
    likeCount.value = prevCount;
    props.comment.isLiked = prevLiked;
    props.comment.likeCount = prevCount;
    error.value = e?.message ?? 'Like failed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article class="comment" :class="{ pinned: comment.isPinned }">
    <img v-if="comment.authorAvatar" :src="comment.authorAvatar" :alt="comment.author" class="avatar" />
    <div v-else class="avatar avatar-placeholder" />
    <div class="body">
      <div class="head">
        <span v-if="comment.isPinned" class="pin" title="Pinned">📌</span>
        <span class="author">{{ comment.author }}</span>
        <span class="time">{{ comment.publishedTime }}</span>
      </div>
      <div class="text">{{ comment.body }}</div>
      <div class="meta">
        <button
          type="button"
          class="like-btn"
          :class="{ liked: isLiked, busy }"
          :disabled="busy"
          :title="canLike ? (isLiked ? 'Unlike' : 'Like') : 'Sign in to like'"
          :aria-pressed="isLiked"
          :aria-label="isLiked ? 'Unlike comment' : 'Like comment'"
          @click="onLike"
        >
          <span class="like-icon" :class="{ anim: likedAnim }">{{ isLiked ? '♥' : '♡' }}</span>
          <span class="like-count">{{ likeCount }}</span>
        </button>
        <span v-if="comment.isHearted" class="hearted" title="Hearted by creator">💗</span>
        <button
          v-if="comment.replyCount > 0 && comment.replyContinuation"
          type="button"
          class="replies-toggle"
          @click="toggle"
        >
          {{ expanded ? 'Hide' : 'Show' }}
          {{ comment.replyCount }}
          {{ comment.replyCount === 1 ? 'reply' : 'replies' }}
        </button>
        <span v-if="busy" class="like-busy">…</span>
      </div>
      <div v-if="error" class="like-error" role="alert">⚠ {{ error }}</div>
      <ReplyList
        v-if="expanded && comment.replyContinuation"
        :comment-id="comment.id"
        :initial-token="comment.replyContinuation"
      />
    </div>
  </article>
</template>

<style scoped>
.comment {
  display: flex;
  gap: 12px;
  padding: 14px 4px;
}
.comment.pinned {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 14px 12px;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
.avatar-placeholder { background: rgba(255, 255, 255, 0.1); }
.body { flex: 1; min-width: 0; }
.head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
}
.pin { font-size: 11px; }
.author { font-weight: 600; color: #fff; }
.time { color: rgba(255, 255, 255, 0.5); font-size: 12px; }
.text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.92);
  line-height: 1.5;
  white-space: pre-wrap;
  margin-top: 4px;
  word-break: break-word;
}
.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}
.like-btn {
  appearance: none;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  transition: background 140ms, color 140ms, transform 140ms, border-color 140ms, box-shadow 140ms;
}
.like-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: translateY(-1px); }
.like-btn:active { transform: translateY(0) scale(0.98); }
.like-btn.liked {
  background: rgba(255, 59, 92, 0.15);
  border-color: rgba(255, 59, 92, 0.35);
  color: #ff8da1;
  box-shadow: 0 0 0 1px rgba(255, 59, 92, 0.1) inset;
}
.like-btn.liked:hover { background: rgba(255, 59, 92, 0.22); color: #ffbfd0; }
.like-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.like-btn.busy { pointer-events: none; }
.like-icon { display: inline-block; transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms; font-size: 13px; line-height: 1; }
.like-icon.anim { transform: scale(1.35); }
.like-count { min-width: 1ch; }
.like-busy { font-size: 11px; color: rgba(255,255,255,0.5); }
.like-error {
  margin-top: 6px;
  font-size: 11px;
  color: #ff8a8a;
  background: rgba(255, 80, 80, 0.08);
  border: 1px solid rgba(255, 80, 80, 0.18);
  padding: 6px 8px;
  border-radius: 6px;
}
.replies-toggle {
  appearance: none;
  background: transparent;
  border: 0;
  color: #62b5ff;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  margin-left: -8px;
  border-radius: 999px;
  cursor: pointer;
}
.replies-toggle:hover {
  background: rgba(98, 181, 255, 0.12);
}
</style>
