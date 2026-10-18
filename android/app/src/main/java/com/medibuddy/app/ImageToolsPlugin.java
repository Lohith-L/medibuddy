package com.medibuddy.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

/**
 * shrinkImage({ base64, maxSide?: 1600, quality?: 80 }) -> { base64, width, height, bytes, ms }
 *
 * Prescription photos are 12 MP; decoding them in the WebView took ~4 s. Android
 * decodes at a reduced size directly (inSampleSize), applies the camera's EXIF
 * rotation and re-encodes a small JPEG, typically in a few hundred ms.
 */
@CapacitorPlugin(name = "ImageTools")
public class ImageToolsPlugin extends Plugin {

    @PluginMethod
    public void shrinkImage(PluginCall call) {
        String in = call.getString("base64");
        if (in == null || in.isEmpty()) {
            call.reject("base64 is required");
            return;
        }
        int maxSide = Math.max(256, call.getInt("maxSide", 1600));
        int quality = Math.max(40, Math.min(95, call.getInt("quality", 80)));
        new Thread(() -> {
            long t0 = System.currentTimeMillis();
            try {
                byte[] bytes = Base64.decode(in, Base64.DEFAULT);

                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                int longest = Math.max(bounds.outWidth, bounds.outHeight);
                if (longest <= 0) throw new IllegalArgumentException("not an image");

                // Largest power-of-two reduction that still keeps >= maxSide pixels.
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = 1;
                while (longest / (opts.inSampleSize * 2) >= maxSide) opts.inSampleSize *= 2;
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                if (bmp == null) throw new IllegalArgumentException("could not decode the image");

                // Exact size + camera rotation in one transform.
                Matrix m = new Matrix();
                float scale = Math.min(1f, (float) maxSide / Math.max(bmp.getWidth(), bmp.getHeight()));
                m.postScale(scale, scale);
                int rotation = exifRotation(bytes);
                if (rotation != 0) m.postRotate(rotation);
                Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
                if (out != bmp) bmp.recycle();

                ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
                out.compress(Bitmap.CompressFormat.JPEG, quality, jpeg);
                JSObject ret = new JSObject();
                ret.put("base64", Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP));
                ret.put("width", out.getWidth());
                ret.put("height", out.getHeight());
                ret.put("bytes", jpeg.size());
                ret.put("ms", System.currentTimeMillis() - t0);
                out.recycle();
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not shrink the image: " + e.getMessage(), e);
            }
        }, "shrink-image").start();
    }

    private static int exifRotation(byte[] bytes) {
        try {
            ExifInterface exif = new ExifInterface(new ByteArrayInputStream(bytes));
            switch (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                case ExifInterface.ORIENTATION_ROTATE_90: return 90;
                case ExifInterface.ORIENTATION_ROTATE_180: return 180;
                case ExifInterface.ORIENTATION_ROTATE_270: return 270;
                default: return 0;
            }
        } catch (Exception e) {
            return 0; // not a JPEG with EXIF: no rotation
        }
    }
}
