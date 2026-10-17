# Romeo Python Client

This SDK is generated from Romeo API 0.1.0. It uses only the Python standard library and exposes a generic OpenAPI operation caller plus small convenience methods for common operations.

## Generate

```sh
node scripts/generate-python-sdk.mjs --openapi-url http://127.0.0.1:3000/api/v1/openapi.json
```

Generated operations: 581

## Example

```py
from romeo_client import RomeoClient

client = RomeoClient(base_url="http://127.0.0.1:3000", api_key="rmk_...")
print(client.health())
agents = client.list_agents("workspace_default")
chat = client.create_chat("workspace_default", "Python check")
run = client.start_run(chat["id"], agents[0]["id"], "Hello Romeo")
device = client.create_device_authorization("MacBook", ["me:read", "chats:read"], ttl_days=90)
rotated = client.refresh_device_authorization(device["refreshToken"])
```
