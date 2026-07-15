import { errorResponse, jsonContent } from "./helpers";

const rawJson = (schema: object, description: string) => ({
  description,
  content: jsonContent(schema),
});

const openWebUiChatListParameters = [
  {
    name: "page",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1 },
  },
  {
    name: "include_pinned",
    in: "query",
    required: false,
    schema: { type: "boolean" },
  },
  {
    name: "include_folders",
    in: "query",
    required: false,
    schema: { type: "boolean" },
  },
];

const openWebUiChannelMessageParameters = [
  { $ref: "#/components/parameters/ChannelId" },
  {
    name: "skip",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: 100_000 },
  },
  {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200 },
  },
];

export const openWebUiPaths = {
  "/auths/": {
    get: {
      summary: "Get OpenWebUI-compatible session user",
      description:
        "Read-only OpenWebUI session-user compatibility endpoint. The response is raw OpenWebUI-shaped JSON, not a Romeo envelope. Romeo authenticates the request through its normal bearer or session-cookie path and does not echo bearer tokens in the response.",
      responses: {
        200: {
          description: "OpenWebUI-compatible session user",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenWebUiSessionUserResponse",
              },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/": {
    get: {
      summary: "List OpenWebUI-compatible chat summaries",
      description:
        "Authenticated OpenWebUI chat-sidebar compatibility endpoint. The response is a raw OpenWebUI-shaped array, not a Romeo envelope, and is backed by caller-visible Romeo chats.",
      parameters: openWebUiChatListParameters,
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible chat summaries",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/list": {
    get: {
      summary: "List OpenWebUI-compatible chat summaries alias",
      description:
        "Alias for the OpenWebUI chat-sidebar list route. The response is raw OpenWebUI-shaped JSON, not a Romeo envelope.",
      parameters: openWebUiChatListParameters,
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible chat summaries",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/new": {
    post: {
      summary: "Create an OpenWebUI-compatible chat",
      description:
        "Imports a simple OpenWebUI chat document into Romeo chat/message storage and returns a raw OpenWebUI-shaped chat response. The route accepts optional folder attachment through Romeo workspace folders.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiCreateChatRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChatResponse" },
          "OpenWebUI-compatible chat",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/pinned": {
    get: {
      summary: "List OpenWebUI-compatible pinned chat summaries",
      description:
        "OpenWebUI pinned-chat compatibility endpoint backed by caller-scoped Romeo resource favorites. The response is raw OpenWebUI-shaped JSON, not a Romeo envelope.",
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible pinned chat summaries",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/{chatId}/pinned": {
    get: {
      summary: "Get OpenWebUI-compatible chat pinned status",
      description:
        "Returns whether the caller has pinned the chat in their OpenWebUI-compatible sidebar. Pin state is per user and backed by Romeo resource favorites.",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      responses: {
        200: rawJson(
          { type: "boolean", nullable: true },
          "OpenWebUI-compatible chat pinned status",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/{chatId}/pin": {
    post: {
      summary: "Toggle OpenWebUI-compatible chat pin state",
      description:
        "Toggles the caller's OpenWebUI-compatible pinned state for a readable Romeo chat and returns a raw OpenWebUI-shaped chat response. The underlying chat is not globally mutated.",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChatResponse" },
          "OpenWebUI-compatible chat",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/search": {
    get: {
      summary: "Search OpenWebUI-compatible chat summaries",
      description:
        "Searches caller-visible active Romeo chats by title and message text and returns raw OpenWebUI-shaped chat summaries.",
      parameters: [
        {
          name: "text",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible chat search summaries",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/archived": {
    get: {
      summary: "List OpenWebUI-compatible archived chat summaries",
      parameters: [
        {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible archived chat summaries",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/all/archived": {
    get: {
      summary: "List all OpenWebUI-compatible archived chats",
      responses: {
        200: rawJson(
          {
            type: "array",
            items: { $ref: "#/components/schemas/OpenWebUiChatResponse" },
          },
          "OpenWebUI-compatible archived chats",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/all/tags": {
    get: {
      summary: "List OpenWebUI-compatible chat tags",
      description:
        "Lists the caller's user-scoped OpenWebUI-compatible chat tags backed by Romeo chat tag storage.",
      responses: {
        200: rawJson(
          {
            type: "array",
            items: { $ref: "#/components/schemas/OpenWebUiTagResponse" },
          },
          "OpenWebUI-compatible chat tags",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/tags": {
    post: {
      summary: "List OpenWebUI-compatible chats by tag",
      description:
        "Lists caller-visible active chats assigned to the requested user-scoped OpenWebUI-compatible tag.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChatTagLookupRequest",
        }),
      },
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible tagged chat summaries",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/chats/{chatId}/tags": {
    get: {
      summary: "List OpenWebUI-compatible tags for a chat",
      description:
        "Returns user-scoped OpenWebUI-compatible tags assigned by the caller to a readable Romeo chat.",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: { $ref: "#/components/schemas/OpenWebUiTagResponse" },
          },
          "OpenWebUI-compatible chat tags",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Assign an OpenWebUI-compatible tag to a chat",
      description:
        "Creates or reuses a caller-scoped OpenWebUI-compatible tag and assigns it to a readable Romeo chat.",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChatTagLookupRequest",
        }),
      },
      responses: {
        200: rawJson(
          {
            type: "array",
            items: { $ref: "#/components/schemas/OpenWebUiTagResponse" },
          },
          "OpenWebUI-compatible chat tags",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Remove an OpenWebUI-compatible tag from a chat",
      description:
        "Removes the caller-scoped OpenWebUI-compatible tag assignment from a readable Romeo chat and deletes orphaned tag rows for that caller.",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChatTagLookupRequest",
        }),
      },
      responses: {
        200: rawJson(
          {
            type: "array",
            items: { $ref: "#/components/schemas/OpenWebUiTagResponse" },
          },
          "OpenWebUI-compatible chat tags",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/folder/{folderId}": {
    get: {
      summary: "List OpenWebUI-compatible chats in a folder",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: { $ref: "#/components/schemas/OpenWebUiChatResponse" },
          },
          "OpenWebUI-compatible chats",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/folder/{folderId}/list": {
    get: {
      summary: "List OpenWebUI-compatible chat summaries in a folder",
      parameters: [
        { $ref: "#/components/parameters/FolderId" },
        {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChatTitleIdResponse",
            },
          },
          "OpenWebUI-compatible folder chat summaries",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/{chatId}/folder": {
    post: {
      summary: "Move an OpenWebUI-compatible chat to a folder",
      description:
        "Moves a caller-writable Romeo chat into an OpenWebUI-compatible Romeo workspace folder, or clears folder membership when folder_id is null or omitted. The response is raw OpenWebUI-shaped JSON, not a Romeo envelope.",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiUpdateChatFolderRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChatResponse" },
          "OpenWebUI-compatible chat",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/": {
    get: {
      summary: "List OpenWebUI-compatible folders",
      description:
        "Authenticated OpenWebUI folder-sidebar compatibility endpoint backed by Romeo workspace folders. The response is a raw OpenWebUI-shaped array, not a Romeo envelope.",
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiFolderListItemResponse",
            },
          },
          "OpenWebUI-compatible folders",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
    post: {
      summary: "Create an OpenWebUI-compatible folder",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiCreateFolderRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiFolderResponse" },
          "OpenWebUI-compatible folder",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/folders/{folderId}": {
    get: {
      summary: "Get an OpenWebUI-compatible folder",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiFolderResponse" },
          "OpenWebUI-compatible folder",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete an OpenWebUI-compatible folder",
      description:
        "Deletes the folder and folder membership rows. Romeo does not delete chat contents from this compatibility route; governed deletion remains separate.",
      parameters: [
        { $ref: "#/components/parameters/FolderId" },
        {
          name: "delete_contents",
          in: "query",
          required: false,
          schema: { type: "boolean" },
        },
      ],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiFolderResponse" },
          "OpenWebUI-compatible deleted folder",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}/update": {
    post: {
      summary: "Update an OpenWebUI-compatible folder",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiUpdateFolderRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiFolderResponse" },
          "OpenWebUI-compatible folder",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}/update/expanded": {
    post: {
      summary: "Update an OpenWebUI-compatible folder expanded state",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiUpdateFolderExpandedRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiFolderResponse" },
          "OpenWebUI-compatible folder",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}/update/parent": {
    post: {
      summary: "Update an OpenWebUI-compatible folder parent",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiUpdateFolderParentRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiFolderResponse" },
          "OpenWebUI-compatible folder",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/": {
    get: {
      summary: "List OpenWebUI-compatible channels",
      description:
        "Authenticated OpenWebUI channel-sidebar compatibility endpoint backed by durable Romeo OpenWebUI channel, member, read-state, and message storage.",
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChannelListItemResponse",
            },
          },
          "OpenWebUI-compatible channels",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/channels/list": {
    get: {
      summary: "List OpenWebUI-compatible channels alias",
      description:
        "Alias for durable OpenWebUI channel list compatibility. The response is raw OpenWebUI-shaped JSON, not a Romeo envelope.",
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChannelListItemResponse",
            },
          },
          "OpenWebUI-compatible channels",
        ),
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/channels/create": {
    post: {
      summary: "Create an OpenWebUI-compatible channel",
      description:
        "Creates a durable OpenWebUI-compatible group, DM, or admin-owned standard channel. Group and DM channels persist explicit member rows; DM creation reuses an existing exact participant match.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelResponse" },
          "OpenWebUI-compatible channel",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/channels/users/{userId}": {
    get: {
      summary: "Get or create an OpenWebUI-compatible DM channel",
      description:
        "Returns an existing exact two-party DM channel or creates one for the caller and target user.",
      parameters: [
        {
          name: "userId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelResponse" },
          "OpenWebUI-compatible DM channel",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/channels/{channelId}": {
    get: {
      summary: "Get an OpenWebUI-compatible channel",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelResponse" },
          "OpenWebUI-compatible channel",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/events": {
    get: {
      summary: "Stream OpenWebUI-compatible channel events",
      description:
        "Authenticated Server-Sent Events stream for channel message lifecycle notifications. Each SSE frame uses `event: events:channel` and JSON data shaped like `OpenWebUiChannelEvent`. This is Romeo's lightweight realtime bridge for the OpenWebUI-reference channel event payloads; native Socket.IO compatibility remains outside the core API contract.",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      responses: {
        200: {
          description: "OpenWebUI-compatible channel event stream",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
                description:
                  "SSE stream carrying OpenWebUiChannelEvent JSON frames.",
              },
            },
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenWebUiChannelEvent",
              },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages": {
    get: {
      summary: "List OpenWebUI-compatible channel messages",
      description:
        "Lists durable channel messages for the caller-visible channel. The response is raw OpenWebUI-shaped JSON, sorted newest first, with reply counters and caller-scoped read state represented on the channel list routes.",
      parameters: openWebUiChannelMessageParameters,
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChannelMessageResponse",
            },
          },
          "OpenWebUI-compatible channel messages",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/post": {
    post: {
      summary: "Post an OpenWebUI-compatible channel message",
      description:
        "Creates a durable message in a Romeo-managed backing chat for the channel. Group and DM members may post; standard channels require channel write access.",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMessageRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelMessageResponse" },
          "OpenWebUI-compatible channel message",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/read": {
    post: {
      summary: "Mark an OpenWebUI-compatible channel as read",
      description:
        "Updates the caller's channel-member last-read timestamp. This provides an HTTP equivalent for OpenWebUI's websocket read-state event until Romeo exposes channel websocket delivery.",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      responses: {
        200: rawJson({ type: "boolean" }, "Channel read state updated"),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/pinned": {
    get: {
      summary: "List pinned OpenWebUI-compatible channel messages",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 10_000 },
        },
      ],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChannelMessageResponse",
            },
          },
          "Pinned OpenWebUI-compatible channel messages",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}": {
    get: {
      summary: "Get an OpenWebUI-compatible channel message",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelMessageResponse" },
          "OpenWebUI-compatible channel message",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/data": {
    get: {
      summary: "Get OpenWebUI-compatible channel message data",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      responses: {
        200: rawJson(
          {
            oneOf: [
              { type: "object", additionalProperties: true },
              { type: "null" },
            ],
          },
          "Channel message data",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/thread": {
    get: {
      summary: "List OpenWebUI-compatible channel thread replies",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
        {
          name: "skip",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, maximum: 100_000 },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200 },
        },
      ],
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChannelMessageResponse",
            },
          },
          "OpenWebUI-compatible channel thread replies",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/pin": {
    post: {
      summary: "Pin or unpin an OpenWebUI-compatible channel message",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMessagePinRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelMessageResponse" },
          "OpenWebUI-compatible channel message",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/update": {
    post: {
      summary: "Update an OpenWebUI-compatible channel message",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMessageRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelMessageResponse" },
          "OpenWebUI-compatible channel message",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/reactions/add": {
    post: {
      summary: "Add an OpenWebUI-compatible channel message reaction",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMessageReactionRequest",
        }),
      },
      responses: {
        200: rawJson({ type: "boolean" }, "Reaction added"),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/reactions/remove": {
    post: {
      summary: "Remove an OpenWebUI-compatible channel message reaction",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMessageReactionRequest",
        }),
      },
      responses: {
        200: rawJson({ type: "boolean" }, "Reaction removed"),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/messages/{messageId}/delete": {
    delete: {
      summary: "Delete an OpenWebUI-compatible channel message",
      description:
        "Soft-deletes the message through append-only message metadata so the greenfield baseline remains unchanged.",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        { $ref: "#/components/parameters/MessageId" },
      ],
      responses: {
        200: rawJson({ type: "boolean" }, "Channel message deleted"),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/members": {
    get: {
      summary: "List OpenWebUI-compatible channel members",
      parameters: [
        { $ref: "#/components/parameters/ChannelId" },
        {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
        },
        {
          name: "query",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelMembersResponse" },
          "OpenWebUI-compatible channel members",
        ),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/members/active": {
    post: {
      summary: "Update current OpenWebUI-compatible channel active state",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMemberActiveRequest",
        }),
      },
      responses: {
        200: rawJson({ type: "boolean" }, "Channel active state updated"),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/update/members/add": {
    post: {
      summary: "Add OpenWebUI-compatible channel members",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMembersUpdateRequest",
        }),
      },
      responses: {
        200: rawJson(
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/OpenWebUiChannelMemberResponse",
            },
          },
          "OpenWebUI-compatible channel members",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/update/members/remove": {
    post: {
      summary: "Remove OpenWebUI-compatible channel members",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelMembersUpdateRequest",
        }),
      },
      responses: {
        200: rawJson(
          { type: "integer" },
          "OpenWebUI-compatible removed member count",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/update": {
    post: {
      summary: "Update an OpenWebUI-compatible channel",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenWebUiChannelRequest",
        }),
      },
      responses: {
        200: rawJson(
          { $ref: "#/components/schemas/OpenWebUiChannelResponse" },
          "OpenWebUI-compatible channel",
        ),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/channels/{channelId}/delete": {
    delete: {
      summary: "Delete an OpenWebUI-compatible channel",
      parameters: [{ $ref: "#/components/parameters/ChannelId" }],
      responses: {
        200: rawJson({ type: "boolean" }, "OpenWebUI-compatible delete result"),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/openwebui/config": {
    get: {
      summary: "Get OpenWebUI-compatible boot configuration",
      description:
        "Read-only OpenWebUI boot compatibility endpoint. The response is raw OpenWebUI-shaped JSON, not a Romeo envelope, and contains only public non-secret feature metadata.",
      responses: {
        200: {
          description: "OpenWebUI-compatible boot configuration",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenWebUiConfigResponse",
              },
            },
          },
        },
      },
    },
  },
  "/openwebui/version": {
    get: {
      summary: "Get OpenWebUI-compatible version metadata",
      description:
        "Read-only OpenWebUI version compatibility endpoint. The response is raw JSON, not a Romeo envelope.",
      responses: {
        200: {
          description: "OpenWebUI-compatible version metadata",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenWebUiVersionResponse",
              },
            },
          },
        },
      },
    },
  },
  "/openwebui/version/updates": {
    get: {
      summary: "Get OpenWebUI-compatible version update metadata",
      description:
        "Read-only OpenWebUI update compatibility endpoint. Romeo does not perform an outbound update check here; current and latest are reported as the running version.",
      responses: {
        200: {
          description: "OpenWebUI-compatible version update metadata",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenWebUiVersionUpdatesResponse",
              },
            },
          },
        },
      },
    },
  },
};
