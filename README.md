# gradec

`gradec` accumulates [score comments](#score-comments) on a GitHub commit,
then pushing a comment with the final score to the ommit.
`gradec` can also push comments linking to a commit's CI builds.

## Usage

After cloning the repo, install the project's dependencies and build `gradec`.
This project uses [yarn](https://yarnpkg.com) as a dependency manager and build runner.

```shell
yarn install
yarn build
```

To run `gradec`, you will neeed to get a [GitHub personal access token](https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line)
and export a __GRADEC_ACCESS_TOKEN__ environment variable with the value of that token. Set the variable in your `.bashrc` or similar if you want to avoid repeating
this for every shell instance.

## Development

Please lint, format, and test your code after development. There are no pre-commit hooks, so this is mostly on an honor system.

This project uses [tslint](https://palantir.github.io/tslint/), [clang-format](https://clang.llvm.org/docs/ClangFormat.html), and [Jasmine](https://jasmine.github.io/)
as a linter, automated formatter, and test framework, respectively. `tslint` and `jasmine` are installed with the project dependencies; `clang-format` must be
installed separately.

```shell
yarn lint
yarn lint:fix # apply some automated linting fixes
yarn format
yarn test
```

## Contribution

There are no formal contribution guidelines for this project.

If you would like to report a bug, ask a question, or request a feature, please open an [issue](https://github.com/ayazhafiz/gradec/issues)
rather than reaching out personally.

If you would like to implement a change, please submit a [PR](https://github.com/ayazhafiz/gradec/pulls)
(and optionally open an issue if your change is significant).
