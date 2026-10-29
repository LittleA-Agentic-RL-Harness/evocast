export class LLMError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
