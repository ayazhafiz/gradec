export interface CommitCommentsRequest {
  body: {body: string;};
  headers: {Authorization: string; 'User-Agent': string;};
  json: boolean;
  uri: string;
}

export interface CommitCommentsResponse {
  body: string;
  node_id: string;
  html_url: string;
  path: string|null;
}

export interface CommitCommentsError {
  message: string;
  options: CommitCommentsRequest;
}

export interface CommentScoreResult {
  comment: string;
  score: number;
  url: string;
}

export interface CommitMetadata {
  author: string;
  commit: string;
  repo: string;
  commitUrl: string;
  testsUrl?: string;
}
