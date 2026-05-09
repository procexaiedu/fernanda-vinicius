import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Apenas imagens são permitidas.' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Arquivo muito grande. Máximo: 5MB.' }, { status: 400 })

  const endpoint = process.env.MINIO_ENDPOINT
  if (!endpoint) {
    return NextResponse.json({ error: 'MinIO não configurado. Foto não salva.' }, { status: 503 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
    const { randomUUID } = await import('crypto')

    const client = new S3Client({
      endpoint: `http://${endpoint}:${process.env.MINIO_PORT ?? 9000}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
      },
      forcePathStyle: true,
    })

    const bucket = process.env.MINIO_BUCKET ?? 'fv-products'
    const ext = file.name.split('.').pop()
    const key = `photos/${randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    }))

    const url = `${process.env.MINIO_PUBLIC_URL}/${bucket}/${key}`
    return NextResponse.json({ url })
  } catch {
    return NextResponse.json({ error: 'Erro ao fazer upload.' }, { status: 500 })
  }
}
