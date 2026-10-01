<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import Drawer from '@/components/Drawer.vue';
import CommentList from '@/components/CommentList.vue';
import SortMenu from '@/components/SortMenu.vue';
import { useVideoId } from '@/composables/useVideoId';
import { useComments } from '@/composables/useComments';
import { useReplies } from '@/composables/useReplies';
import { usePlayerBarButton } from '@/composables/usePlayerBarButton';
import { warnOnce } from '@/lib/log';

const ctx = inject<ContentScriptContext>('ctx')!;
const { videoId, pathname } = useVideoId(ctx);
const isWatchPage = computed(() => pathname.value === '/watch' && !!videoId.value);

// visibility failures are silent by design (button just gets display:none) —
// surface them once so "icon vanished" traces to url detection vs dom anchor
watch(
  [pathname, videoId],
  ([p, v]) => {
    warnOnce(`nav ${p}`, `pathname=${p} videoId=${v || '(none)'}`);
    if (p === '/watch' && !v) {
      warnOnce('watch-no-video-id', 'on /watch but no ?v= param — comments button hidden. href=', location.href);
    }
    if (p !== '/watch' && new URLSearchParams(location.search).has('v')) {
      warnOnce('watch-path-changed', `video id present but pathname is not /watch — yt music may have changed the route. pathname=${p} href=`, location.href);
    }
  },
  { immediate: true },
);

const open = ref(false);
const { state, loadMore, setSort } = useComments(videoId, isWatchPage);
const replies = useReplies();

watch(videoId, () => {
  replies.reset();
});

usePlayerBarButton(open, isWatchPage, () => {
  open.value = !open.value;
});
</script>

<template>
  <Drawer
    :open="open"
    :visible="isWatchPage"
    @close="open = false"
  >
    <template #header-actions>
      <SortMenu
        :sort="state.sort"
        :disabled="state.status === 'loading' || state.status === 'disabled'"
        @change="setSort"
      />
    </template>
    <CommentList
      :items="state.items"
      :status="state.status"
      :error="state.error"
      :has-more="!!state.nextPageToken"
      @load-more="loadMore"
    />
  </Drawer>
</template>
