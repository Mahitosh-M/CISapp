import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from '../firebase';

const OFFER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const OFFER_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface UploadedOfferImage {
  imageUrl: string;
  imagePath: string;
}

export const validateOfferImageFile = (file: File) => {
  if (!OFFER_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    return 'Only JPG, PNG, or WebP offer images are allowed.';
  }

  if (file.size > OFFER_IMAGE_MAX_BYTES) {
    return 'Image is too large. Please upload image below 2 MB.';
  }

  return '';
};

export const getSafeFileName = (fileName: string) => {
  const cleanedName = fileName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/_+/g, '_');

  return cleanedName || 'offer-image';
};

export const buildOfferImagePath = (file: File, offerId?: string) => {
  const fileName = `${Date.now()}_${getSafeFileName(file.name)}`;
  return offerId ? `offers/${offerId}/${fileName}` : `offers/${fileName}`;
};

export const uploadOfferImage = (file: File, offerId?: string, onProgress?: (progress: number) => void) =>
  new Promise<UploadedOfferImage>((resolve, reject) => {
    const imagePath = buildOfferImagePath(file, offerId);
    const storageRef = ref(storage, imagePath);

    // Firebase Storage keeps offer images separate from Firestore; Firestore stores only imageUrl/imagePath.
    const uploadTask = uploadBytesResumable(storageRef, file, { contentType: file.type });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (!onProgress) return;

        const progress = snapshot.totalBytes > 0 ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0;
        onProgress(progress);
      },
      (error) => reject(error),
      async () => {
        try {
          const imageUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({ imageUrl, imagePath });
        } catch (error) {
          reject(error);
        }
      }
    );
  });
