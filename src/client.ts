import * as rp from 'request-promise';
import * as util from 'util';
import {argv} from 'yargs';

const MAXSCORE: number = Number(process.env.MAXSCORE || 100);
const SCORE_PREFIX = 'Score:';

export interface RequestMetadata {
  accessToken: string;
  repo: string;
  commit: string;
}

function makeRequest({
  accessToken,
  repo,
  commit,
  message,
}: RequestMetadata&{message?: string}) {
  const request: any = {
    headers: {
      'Authorization': `token ${accessToken}`,
      'User-Agent': 'gradec',
    },
    json: true,
    uri: `https://api.github.com/repos/${repo}/commits/${commit}/comments`,
  };
  if (message) {
    request.body = {body: message};
  }
  return request;
}

function handleCommentSuccess(resp: any) {
  console.error(
      `Successfully posted comment \`${resp.body}' to\n\t${resp.html_url}`);
  console.error(`Please verify this comment at the URL above.`);
  return 0;
}

function handleFailedRequest(err: any) {
  console.error(`Failed to process request\n${util.inspect(err.options)}`);
  console.error(`Dumping request error message and exiting.\n`);
  console.error(util.inspect(err.message));
  return 1;
}

/**
 * Reads comment of form
 *   $SCORE:$EXTRA_COMMENT
 * applied to files on the commit and accumulates discovered $SCORES on
 * MAX_SCORE. If a grade has already been given to the commit, this is a no-op.
 */
export async function scoreComments(options: RequestMetadata):
    Promise<{skip: true, comment: string}|{skip: false, score: number}> {
  const result = await rp.get(makeRequest(options)).catch(handleFailedRequest);
  // Look for a commit comment with the final score. If one is found, we are
  // already done.
  const skip = result.filter((cmt: any) => cmt.path === null)
                   .map((cmt: any) => cmt.body)
                   .find((cmt: string) => cmt.startsWith(SCORE_PREFIX));
  if (skip) {
    return {skip: true, comment: skip};
  }

  const fileComments: string[] = result.filter((cmt: any) => cmt.path !== null)
                                     .map((cmt: any) => cmt.body);
  // Grab $SCORE in comments of form $SCORE:$EXTRA_COMMENT"
  const scores = fileComments.map((cmt) => cmt.split(':')[0].trim())
                     .filter((cmt) => cmt.length)
                     .map(Number)
                     .filter(Number.isInteger);

  console.error(`Found ${scores.length} score comments in all ${
      fileComments.length} file comments:\n\t${scores.join(', ')}\n`);

  const score = scores.reduce((total, part) => total + part, MAXSCORE);
  console.error(`Final score: ${score}/${MAXSCORE}`);

  return {skip: false, score};
}

/**
 * Grades a repo commit, if it has not been graded already, providing the grade
 * as a commit comment.
 */
export async function gradeCommit(options: RequestMetadata) {
  const result = await scoreComments(options);

  if (result.skip) {
    console.error(`Already discovered a score comment:\n\t${result.comment}`);
    console.error(`Skipping.`);
    return 0;
  }

  const scoreComment = `${SCORE_PREFIX} ${result.score}/${MAXSCORE}`;
  const commentRequest = makeRequest({...options, message: scoreComment});

  return await rp.post(commentRequest)
      .promise()
      .then(handleCommentSuccess)
      .catch(handleFailedRequest);
}

if (require.main === module) {
  (async () => {
    const accessToken = process.env['GRADEC_ACCESS_TOKEN'];
    const repo = argv.repo as string | undefined;
    const commit = argv.commit as string | undefined;
    for (const arg of [accessToken, repo, commit]) {
      if (!arg) {
        console.error(
            `Please make sure a \`GRADEC_ACCESS_TOKEN' environment variable is set to a GitHub OAuth access token\nand that you have passed correct \`--repo' and \`--commit' arguments.`);
        process.exit(1);
      }
    }

    process.exitCode = await gradeCommit(
        {accessToken: accessToken!, repo: repo!, commit: commit!});
  })();
}
