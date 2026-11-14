import type { ChatAttachment, EnvironmentId } from "@t3tools/contracts";
import type { ComposerFileAttachment } from "~/composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseAttachmentUpload,
  startAttachmentUpload,
} from "~/lib/attachmentUploadQueue";
import { randomUUID } from "~/lib/utils";

export async function sendChipDatasheet(
  environmentId: EnvironmentId,
  file: File,
  send: (attachments: ChatAttachment[]) => Promise<boolean>,
): Promise<string | null> {
  const attachment: ComposerFileAttachment = {
    id: randomUUID(),
    type: "file",
    name: file.name,
    mimeType: "application/pdf",
    sizeBytes: file.size,
    file,
  };
  try {
    startAttachmentUpload({ environmentId, image: attachment });
    await awaitAttachmentUploads([attachment.id]);
    const uploaded = getUploadedAttachments({ environmentId, images: [attachment] });
    if (uploaded === null) {
      const upload = readAttachmentUpload(attachment.id);
      return upload?.status === "failed" ? upload.reason : "Could not upload the datasheet.";
    }
    return (await send(uploaded)) ? null : "Could not send the chip request. Try again.";
  } finally {
    releaseAttachmentUpload(attachment.id);
  }
}
