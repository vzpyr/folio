export interface ShareAttachment {
  id: string;
  name: string;
  mime: string | null;
  data: string;
}

export interface SharePayload {
  version: number;
  title: string;
  body: string;
  tags: string[];
  created: number;
  updated: number;
  attachments: ShareAttachment[];
}

export interface ShareMeta {
  id: string;
  note_id: string;
  has_password: boolean;
  salt?: string | null;
  wrapped_key?: string | null;
  verifier?: string | null;
  expires_at?: number | null;
  max_views?: number | null;
  view_count: number;
  created_at: number;
}

export interface CreateShareParams {
  id: string;
  note_id: string;
  nonce: string;
  blob: string;
  has_password: boolean;
  salt?: string | null;
  wrapped_key?: string | null;
  verifier?: string | null;
  expires_at?: number | null;
  max_views?: number | null;
}

export interface ShareResponse {
  id: string;
  has_password: boolean;
  salt?: string | null;
  wrapped_key?: string | null;
  nonce?: string;
  blob?: string;
  expires_at?: number | null;
  max_views?: number | null;
  view_count?: number;
}
