import { dataEnvelope, errorResponse, jsonContent } from "./helpers";

const channelIdParameter = {
  name: "channelId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const messageIdParameter = {
  name: "messageId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const userIdParameter = {
  name: "userId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const reactionNameParameter = {
  name: "name",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 80 },
};

const paginationParameters = [
  {
    name: "offset",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1 },
  },
  {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200 },
  },
];

const channelResponse = {
  description: "Native Romeo collaboration channel",
  content: jsonContent(
    dataEnvelope({ $ref: "#/components/schemas/Channel" }),
  ),
};

const channelMessageResponse = {
  description: "Native Romeo channel message",
  content: jsonContent(
    dataEnvelope({ $ref: "#/components/schemas/ChannelMessage" }),
  ),
};

const channelMessageListResponse = {
  description: "Native Romeo channel messages",
  content: jsonContent(
    dataEnvelope({
      type: "array",
      items: { $ref: "#/components/schemas/ChannelMessage" },
    }),
  ),
};

export const channelPaths = {
  "/collaboration/channels": {
    get: {
      summary: "List native Romeo collaboration channels",
      description:
        "Lists caller-visible channels using Romeo-native response shapes. This endpoint is independent of the optional OpenWebUI reference bridge.",
      responses: {
        200: {
          description: "Native Romeo collaboration channels",
          content: jsonContent(
            dataEnvelope({
              type: "array",
              items: { $ref: "#/components/schemas/Channel" },
            }),
          ),
        },
        403: errorResponse,
      },
    },
    post: {
      summary: "Create a native Romeo collaboration channel",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateChannelRequest",
        }),
      },
      responses: {
        201: channelResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/direct-messages": {
    post: {
      summary: "Get or create a native Romeo direct-message channel",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateDirectMessageChannelRequest",
        }),
      },
      responses: {
        201: channelResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}": {
    get: {
      summary: "Get a native Romeo collaboration channel",
      parameters: [channelIdParameter],
      responses: {
        200: channelResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      summary: "Update a native Romeo collaboration channel",
      parameters: [channelIdParameter],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateChannelRequest",
        }),
      },
      responses: {
        200: channelResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete a native Romeo collaboration channel",
      parameters: [channelIdParameter],
      responses: {
        200: channelResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/events": {
    get: {
      summary: "Stream native Romeo channel events",
      parameters: [channelIdParameter],
      responses: {
        200: {
          description: "Server-Sent Events stream carrying ChannelEvent JSON",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
                description:
                  "Each SSE frame uses event: events:channel and JSON ChannelEvent data.",
              },
            },
            "application/json": {
              schema: { $ref: "#/components/schemas/ChannelEvent" },
            },
          },
        },
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/members": {
    get: {
      summary: "List native Romeo channel members",
      parameters: [channelIdParameter],
      responses: {
        200: {
          description: "Native Romeo channel members",
          content: jsonContent(
            dataEnvelope({
              type: "array",
              items: { $ref: "#/components/schemas/ChannelMember" },
            }),
          ),
        },
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Add native Romeo channel members",
      parameters: [channelIdParameter],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/AddChannelMembersRequest",
        }),
      },
      responses: {
        201: {
          description: "Native Romeo channel members added",
          content: jsonContent(
            dataEnvelope({
              type: "array",
              items: { $ref: "#/components/schemas/ChannelMember" },
            }),
          ),
        },
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/members/{userId}": {
    delete: {
      summary: "Remove a native Romeo channel member",
      parameters: [channelIdParameter, userIdParameter],
      responses: {
        200: {
          description: "Native Romeo channel member removal result",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/ChannelMemberRemovalResult",
            }),
          ),
        },
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages": {
    get: {
      summary: "List native Romeo channel messages",
      parameters: [channelIdParameter, ...paginationParameters],
      responses: {
        200: channelMessageListResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Post a native Romeo channel message",
      parameters: [channelIdParameter],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateChannelMessageRequest",
        }),
      },
      responses: {
        201: channelMessageResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/read": {
    post: {
      summary: "Mark a native Romeo channel as read",
      parameters: [channelIdParameter],
      responses: {
        200: channelResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages/pinned": {
    get: {
      summary: "List pinned native Romeo channel messages",
      parameters: [
        channelIdParameter,
        {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: channelMessageListResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages/{messageId}": {
    get: {
      summary: "Get a native Romeo channel message",
      parameters: [channelIdParameter, messageIdParameter],
      responses: {
        200: channelMessageResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      summary: "Update a native Romeo channel message",
      parameters: [channelIdParameter, messageIdParameter],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateChannelMessageRequest",
        }),
      },
      responses: {
        200: channelMessageResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete a native Romeo channel message",
      parameters: [channelIdParameter, messageIdParameter],
      responses: {
        200: {
          description: "Native Romeo channel message deletion result",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/ChannelMessageDeletionResult",
            }),
          ),
        },
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages/{messageId}/thread": {
    get: {
      summary: "List native Romeo channel message thread replies",
      parameters: [
        channelIdParameter,
        messageIdParameter,
        ...paginationParameters,
      ],
      responses: {
        200: channelMessageListResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages/{messageId}/pin": {
    post: {
      summary: "Pin or unpin a native Romeo channel message",
      parameters: [channelIdParameter, messageIdParameter],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/PinChannelMessageRequest",
        }),
      },
      responses: {
        200: channelMessageResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages/{messageId}/reactions": {
    post: {
      summary: "Add a native Romeo channel message reaction",
      parameters: [channelIdParameter, messageIdParameter],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ChannelMessageReactionRequest",
        }),
      },
      responses: {
        201: channelMessageResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/collaboration/channels/{channelId}/messages/{messageId}/reactions/{name}": {
    delete: {
      summary: "Remove a native Romeo channel message reaction",
      parameters: [channelIdParameter, messageIdParameter, reactionNameParameter],
      responses: {
        200: channelMessageResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
