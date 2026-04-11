-- Add medicine_photo_url column to medicines table
ALTER TABLE public.medicines ADD COLUMN medicine_photo_url text;

-- Create storage bucket for medicine photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('medicine-photos', 'medicine-photos', true);

-- Allow authenticated users to upload medicine photos
CREATE POLICY "Authenticated users can upload medicine photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'medicine-photos');

-- Allow public read access (needed for emails)
CREATE POLICY "Anyone can view medicine photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'medicine-photos');

-- Allow authenticated users to update their own photos
CREATE POLICY "Authenticated users can update medicine photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'medicine-photos');

-- Allow authenticated users to delete their own photos
CREATE POLICY "Authenticated users can delete medicine photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'medicine-photos');