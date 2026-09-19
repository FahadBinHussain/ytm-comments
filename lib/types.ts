export type SortKey = 'top' | 'newest';

export interface Comment {
  id: string;
  author: string;
  authorAvatar: string | null;
  authorChannelId: string | null;
  body: string;
  publishedTime: string;
  likeCount: string;
  replyCount: number;
  isHearted: boolean;
  isPinned: boolean;
  isLiked: boolean;
  isDisliked: boolean;
  canLike: boolean;
  likeCommand: any | null;
  unlikeCommand: any | null;
  replyContinuation: string | null;
}

export interface Reply {
  id: string;
  author: string;
  authorAvatar: string | null;
  authorChannelId: string | null;
  body: string;
  publishedTime: string;
  likeCount: string;
  isHearted: boolean;
  isLiked: boolean;
  isDisliked: boolean;
  canLike: boolean;
  likeCommand: any | null;
  unlikeCommand: any | null;
}

export interface CommentsPage {
  items: Comment[];
  nextPageToken: string | null;
  sortTokens: { top: string | null; newest: string | null };
}

export interface RepliesPage {
  items: Reply[];
  nextPageToken: string | null;
}

export interface ClientContext {
  client: {
    clientName: string;
    clientVersion: string;
    hl: string;
    gl: string;
    userAgent?: string;
    visitorData?: string;
  };
}
