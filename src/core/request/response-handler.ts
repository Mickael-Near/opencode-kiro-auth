import { transformSdkStream } from '../../plugin/streaming/sdk-stream-transformer.js'
import type { ToolNameMap } from '../../plugin/types.js'

export class ResponseHandler {
  /**
   * Wrap the SDK event stream in an OpenAI-compatible SSE response. The
   * transformer owns the Anthropic-to-OpenAI conversion, token accounting and
   * stop-reason synthesis.
   */
  async handleSdkSuccess(
    sdkResponse: any,
    model: string,
    conversationId: string,
    toolNameMap?: ToolNameMap
  ): Promise<Response> {
    const stream = transformSdkStream(sdkResponse, model, conversationId, toolNameMap)
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const event of stream) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
            }
            controller.close()
          } catch (err) {
            controller.error(err)
          }
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
  }
}
