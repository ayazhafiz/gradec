# gradec

`gradec` is a tool for grading student assignment on GitHub.
`gradec` accumulates [score comments](#score-comments) on a GitHub commit, and
records the final grade of the assignment on the commit. `gradec` works with
commits' CI builds, and can retrieve the grade of an assignment at a later time.

## Installation

### Binary releases

You can install the [latest build from master](https://github.com/ayazhafiz/gradec/releases/tag/e05fb66)
for Linux, macOS, and Windows on the releaes page.

### From source

This project uses [yarn](https://yarnpkg.com) as a dependency manager and build
tool. After cloning the repo, install the project's dependencies and the
`gradec` command globally:

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

`gradec` is designed to run on a batch of assignment submissions to grade.

After installing, please run `gradec --help` for usage information and available options.

#### Score comments

`gradec` calculates the grade/score of an assignment by accumulating _score comments_ on a commit.
Score comments have the grammar

```regex
([+|-]\d+)(:.*)?
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

```shell
yarn format
yarn lint
yarn lint:fix # apply some automated linting fixes
yarn test
```

## Contribution

All contributions are welcomed and highly appreciated.

If you would like to report a bug, ask a question, or request a feature, please
open an [issue](https://github.com/ayazhafiz/gradec/issues).

If you would like to implement a change, please submit a
[PR](https://github.com/ayazhafiz/gradec/pulls). If your change is significant, it is usually worth
opening an issue for discussion.
