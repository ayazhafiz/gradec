import * as fs from 'fs';
import * as util from 'util';
import * as api from './api';
import {Grader} from './grader';

interface AuthorListing {
  readonly author: string;
  readonly url: string;
}
/**
 * A file system wrapped specifically designed for reading and writing files
 * used by gradec.
 */
class GradecFs {
  public readonly commits: ReadonlyArray<AuthorListing>;
  public readonly tests: ReadonlyArray<AuthorListing>;

  constructor(commitsFile: string, testsFile: string) {
    function split(file: string) {
      return fs.readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line.length)
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
 * Provides a API for client usage of gradec, e.g. on a console.
 */
export class GradecServer {
  private static handleFailedRequest(err: api.CommitCommentsError): number {
    console.error(`Failed to process request\n${util.inspect(err.options)}`);
    console.error(`Dumping request error message and exiting.\n`);
    console.error(util.inspect(err.message));
    return 1;
  }
  private readonly fs: GradecFs;
  private readonly commitMetas: api.CommitMetadata[] = [];

  constructor(
      files: {commits: string, tests: string},
      private readonly bounds: {readonly start: number, readonly end: number}) {
    this.fs = new GradecFs(files.commits, files.tests);
    const {commits, tests} = this.fs;

    this.commitMetas = commits.map((record, idx) => {
      const match = record.url.match(/.*github.com\/(.*)\/commit\/(.*)/)!;
      if (!match) {
        throw new Error(`Expected ${record.url} to be a GitHub url.`);
      }
      const [, repo, commit] = match;
      const meta: api.CommitMetadata = {
        author: record.author,
        commit,
        commitUrl: commits[idx].url,
        repo,
        testsUrl: tests[idx].url,
      };

      return meta;
    });
  }

  /**
   * Creates and returns a Grader for the collection of commits the server knows
   * about.
   */
  public async makeGrader(accessToken: string): Promise<Grader> {
    return Grader.makeGrader(
        this.commitMetas, this.bounds.start, this.bounds.end, accessToken,
        GradecServer.handleFailedRequest);
  }
}
