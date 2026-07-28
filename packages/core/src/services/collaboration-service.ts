import { CollaborationFolderService } from "./collaboration-folder-service";

export type { AgentGalleryItem } from "./collaboration-favorite-service";
export { CollaborationFavoriteService } from "./collaboration-favorite-service";
export { CollaborationFolderService } from "./collaboration-folder-service";
export type { ShareInput, ShareTarget } from "./collaboration-share-service";
export { CollaborationShareService } from "./collaboration-share-service";

export class CollaborationService extends CollaborationFolderService {}
