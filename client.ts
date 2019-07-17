import * as rp from 'request-promise';
import * as util from 'util';

const MAXSCORE: number = Number(process.env['MAXSCORE'] || 100);
const SCORE_PREFIX = 'Score:'

function makeRequest({
  accessToken,
  repo,
  commit,
  message,
}: {
  accessToken: string,
  repo: string,
  commit: string,
  message?: string,
}) {
  const request: any = {
    uri: `https://api.github.com/repos/${repo}/commits/${commit}/comments`,
    headers: {
      'User-Agent': 'graderc',
      'Authorization': `token ${accessToken}`,
    },
    json: true,
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
  console.error(`Failed to process request\n${util.inspect(err.options)}`)
  console.error(`Dumping request error message and exiting.\n`);
  console.error(util.inspect(err.message));
  return 1;
}

async function scoreComments(options: {
  accessToken: string,
  repo: string,
  commit: string,
}): Promise<{skip: true, comment: string}|{skip: false, score: number}> {
  const result = await rp.get(makeRequest(options)).catch(handleFailedRequest);
  const skip = result.filter((cmt: any) => cmt.path === null)
                   .map((cmt: any) => cmt.body)
                   .find((cmt: string) => cmt.startsWith(SCORE_PREFIX));
  if (skip) return {skip: true, comment: skip};

  const fileComments: string[] = result.filter((cmt: any) => cmt.path !== null)
                                     .map((cmt: any) => cmt.body);
  const scores = fileComments.map(cmt => cmt.split(':')[0].trim())
                     .filter(cmt => cmt.length)
                     .map(Number)
                     .filter(Number.isInteger);
  console.error(`Found ${scores.length} score comments in all ${
      fileComments.length} file comments:\n\t${scores}\n`);
  const score = scores.reduce((total, part) => total + part, MAXSCORE);
  console.error(`Final score: ${score}/${MAXSCORE}`);
  return {skip: false, score};
}

async function main(argv: string[]) {
  const access = process.env['ACCESS_TOKEN'];
  if (!access) {
    console.error(
        'Please provide a GitHub OAuth access token as an "ACCESS_TOKEN" environment variable.');
    return 2;
  }
  const options = {
    accessToken: access,
    repo: 'ayazhafiz/position',
    commit: '8eaae101c98c4ef78ae840488a5932462f12bd4c',
  };

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
    process.exitCode = await main(process.argv.slice(2));
  })()
}
