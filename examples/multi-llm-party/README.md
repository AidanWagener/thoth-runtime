# multi-llm-party example

> Stub — full implementation in v0.6 per [SPEC-multi-llm-party](../../docs/specs/SPEC-multi-llm-party.md).

## Status

This example will demonstrate Thoth's signature capability: **a council
of personas debating across heterogeneous models** — Mary on GPT-5, John
on Claude Opus, Winston on Gemini Pro, James on Claude Haiku, with
synthesis on the founder's chosen model and cross-persona blind review.

Target: 2027-03-31. Track at
[github.com/thoth-runtime/thoth/issues](https://github.com/thoth-runtime/thoth/issues)
under the `multi-llm-party` label.

## Planned features

- 4-persona party with each persona on a different model provider
- Adaptive stability detection (stop when consensus stabilizes)
- Sycophancy detection (force dissent when peacemaker mode collapses)
- Cross-persona blind review (judge anonymized)
- Per-persona cost telemetry
- Slack rendering with provider-color tints + sigils per persona

## License

MIT
