# gradec

`gradec` accumulates [score comments](#score-comments) on a GitHub commit, then
pushing a comment with the final score to the commit. `gradec` can also push
comments linking to a commit's CI builds.

## Installation

This project uses [yarn](https://yarnpkg.com) as a dependency manager and build
runner. After cloning the repo, install the project's dependencies and install
the global `gradec` command.

```shell
yarn install
yarn install-global
```

To run `gradec`, you will neeed to get a
[GitHub personal access token](https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line)
and export a **GRADEC_ACCESS_TOKEN** environment variable with the value of that
token. Set the variable in your `.bashrc` or similar if you want to avoid
repeating this for every shell instance.

## Usage

```
Usage: gradec [options]

Commands:
  gradec grade  perform assignment grading    [default]
  gradec list   list assignment grade status

Options:
  --version          Show version number                              [boolean]
  --ao, --auto-open  Automatically opens links in a browser           [string] [default: "Safari"]
  -c, --commits      (GitHub) commits to grade                        [string] [required]
  -t, --tests        CI tests to grade                                [string] [required]
  -r, --range        Space-separated range of line numbers to grade   [array] [required]
  -h, --help         Show help                                        [boolean]

Examples:
  gradec grade -c commits.txt -t travis.txt -r 1 20     grade lines 1-20 in `commits.txt' and `travis.txt'
  gradec -c c.txt -t t.txt -r 5 10 -ao "Google Chrome"  grade lines 5-10 in `c.txt' and `t.txt', auto-opening links in Google Chrome
  gradec list -c c.txt -t t.xt -r 5 10                  list grading status of lines 5-10 in `c.txt' and `t.txt'
  gradec list -c c.txt -t t.xt -r 5 10 > grades.txt     write any known grades for assignments on lines 5-10 to `grades.txt'
```

#### Score comments

`gradec` calculates the grade/score of an assignment by accumulating _score comments_ on a commit.
Score comments have the (regex) grammar

```typescript
/([+|-]\d+)(:.*)?/
```

where only the first capturing group is used in accumultating the total score.

Score comments:

- `+3: nice!` (+3 to score)
- `-2: consider...` (-2 to score)
- `-1` (-1 to score)

Not score comments:

- `observation...` (+0 to score)
- `3` (+0 to score)
- `-` (+0 to score)

#### Partial grading

`gradec` has particular behavior for assignments that are in the process of or
have been graded:

1. Assignments that `gradec` has graded in the past are not included as needing
   to be graded.
2. Assignments for which `gradec` has previously commented a CI tests link tests
   are not issued a new CI tests link comment.

## Development

Please lint, format, and test your code after development. There are no
pre-commit hooks, so this is mostly on an honor system.

This project uses [tslint](https://palantir.github.io/tslint/),
[clang-format](https://clang.llvm.org/docs/ClangFormat.html), and
[Jasmine](https://jasmine.github.io/) as a linter, automated formatter, and test
framework, respectively. `tslint` and `jasmine` are installed with the project
dependencies; `clang-format` must be installed separately.

```shell
yarn format
yarn lint
yarn lint:fix # apply some automated linting fixes
yarn test
```

## Contribution

There are no formal contribution guidelines for this project.

If you would like to report a bug, ask a question, or request a feature, please
open an [issue](https://github.com/ayazhafiz/gradec/issues) rather than reaching
out personally.

If you would like to implement a change, please submit a
[PR](https://github.com/ayazhafiz/gradec/pulls) (and optionally open an issue if
your change is significant).
