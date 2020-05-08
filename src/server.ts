import * as fs from 'fs';
import * as util from 'util';
import * as api from './api';
import {getScoreComments, Grader, makeCommitRequestMetadata} from './grader';

/** Describes a "<author> <url>" line listing. */
interface AuthorListing {
  readonly author: string;
  readonly url: string;
}
/**
 * A file system wrapped specifically designed for reading and writing files
 * used by gradec.
 */
class GradecFs {
  /** Listing of all commit URLs recovered from the file system. */
  public readonly commits: ReadonlyArray<AuthorListing>;
  /** Listing of all test URLs recovered from the file system. */
  public readonly tests: ReadonlyArray<AuthorListing>;

  constructor(commitsFile: string, testsFile: string) {
    function split(file: string) {
      return fs.readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line.length)  // discard empty lines
          .map((line) => {
            // A line in the file should look like
            //   "<author> <url>"
            const [author, url] = line.split(' ');
            return {author, url};
          });
    }

    this.commits = split(commitsFile);
    this.tests = split(testsFile);
  }
}

/**
 * Provides an encapsulation of gradec that can be queried by a client, e.g. for
 * usage on a CLI.
 */
export class GradecServer {
  /**
   * Common handle for handling failed Grader requests. See `Grader#onError` for
   * more details.
   */
  private static handleFailedRequest(err: api.CommitCommentsError): number {
    console.error(`Failed to process request\n${util.inspect(err.options)}`);
    console.error(`Dumping request error message and exiting.\n`);
    console.error(util.inspect(err.message));
    return 1;
  }
  /** Gradec filesystem. */
  private readonly fs: GradecFs;
  /**
   * Metadata about all the commits the server has extracted from the
   * filesystem.
   */
  private readonly commitMetas: api.CommitMetadata[] = [];
  /** Errors in encountered commits. */
  private readonly errors: string[] = [];

  /**
   * Creates a new GradecServer.
   *
   * @param files commit and test URLs files to grade.
   * @param bounds starting and stopping lines of the commit and test files to
   *     grade.
   */
  constructor(
      files: {commits: string, tests: string},
      private readonly bounds: {readonly start: number, readonly end: number}) {
    this.fs = new GradecFs(files.commits, files.tests);
    const {commits, tests} = this.fs;

    for (let i = this.bounds.start; i < commits.length && i <= this.bounds.end;
         ++i) {
      const record = commits[i];
      // TODO: consider supporting non-GitHub (GitLab?) URLs.
      const match = record.url.match(/.*github.com\/(.*)\/commit\/(.*)/)!;
      if (!match) {
        this.errors.push(`GitHub commit missing for ${record.author}`);
        continue;
      }
      const [, repo, commit] = match;
      const meta: api.CommitMetadata = {
        author: record.author,
        commit,
        commitUrl: commits[i].url,
        repo,
        testsUrl: tests[i].url,
      };

      this.commitMetas.push(meta);
    }
  }

  /**
   * Creates and returns a Grader for the collection of commits the server knows
   * about.
   *
   * @param accessToken GitHub access token for Grader to use
   * @return promise containing created grader
   */
  public async makeGrader(accessToken: string): Promise<Grader> {
    return await Grader.makeGrader(
        this.commitMetas, accessToken, GradecServer.handleFailedRequest);
  }

  /**
   * Gets information about any already-known final scores in the assignments
   * the server has been created for.
   *
   * @param accessToken GitHub access token to use in querying for commits
   * @return promise containing array of commit authors and their known score,
   *     if any.
   */
  public async getGradeStatus(accessToken: string):
      Promise<ReadonlyArray<{author: string, score: number|string|undefined}>> {
    const commits = this.commitMetas;

    // Map comments to their scores, only if the score actually exists;
    // otherwise, keep the score as `undefined`.
    const scores = await Promise.all(commits.map((commit) => {
      const meta = makeCommitRequestMetadata(accessToken, commit);
      return getScoreComments(meta).then(
          (comments) => comments.find((c) => !!c));
    }));

    // Map each score (known or unknown) to the author of the commit the score
    // is for.
    return scores.map((score, index) => {
      return {
        author: this.commitMetas[index].author,
        score,
      };
    });
  }

  public getErrors(): ReadonlyArray<string> {
    return this.errors;
  }
}
