using MemoryPack;
using ZstdSharp;

namespace NzbWebDAV.Database;

public class BlobStore
{
    private static readonly int CompressionLevel = 1;
    private static readonly string ConfigPath = DavDatabaseContext.ConfigPath;
    private static readonly Lock LockObj = new();

    private static string GetBlobPath(Guid id)
    {
        var guidStr = id.ToString("N"); // Without hyphens
        var firstTwo = guidStr[..2];
        var nextTwo = guidStr.Substring(2, 2);
        var fileName = id.ToString(); // With hyphens for readability

        return Path.Combine(ConfigPath, "blobs", firstTwo, nextTwo, fileName);
    }

    private static string CreateBlobTempPath(Guid id)
    {
        var blobPath = GetBlobPath(id);
        var directory = Path.GetDirectoryName(blobPath);

        // Acquire file handle inside lock to prevent race condition where
        // directory gets deleted between CreateDirectory and File.Create
        lock (LockObj)
        {
            Directory.CreateDirectory(directory!);
        }

        return Path.Combine(directory!, $".{id:N}.{Guid.NewGuid():N}.tmp");
    }

    private static async Task WriteBlobAtomically(Guid id, Func<Stream, Task> writeContent)
    {
        var blobPath = GetBlobPath(id);
        var tempPath = CreateBlobTempPath(id);
        try
        {
            await using (var fileStream = new FileStream(
                tempPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                useAsync: true))
            {
                await writeContent(fileStream).ConfigureAwait(false);
                await fileStream.FlushAsync().ConfigureAwait(false);
            }

            // Existing readers retain their old file handle while new opens see
            // the fully written replacement, avoiding partial blob reads.
            File.Move(tempPath, blobPath, overwrite: true);
        }
        catch
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
            throw;
        }
    }

    public static async Task WriteBlob(Guid id, Stream stream)
    {
        await WriteBlobAtomically(
            id,
            fileStream => stream.CopyToAsync(fileStream));
    }

    public static async Task WriteBlob<T>(Guid id, T blob)
    {
        await WriteBlobAtomically(id, async fileStream =>
        {
            await using var compressionStream = new CompressionStream(fileStream, CompressionLevel);
            await MemoryPackSerializer.SerializeAsync(compressionStream, blob).ConfigureAwait(false);
        });
    }

    public static Stream? ReadBlob(Guid id)
    {
        var blobPath = GetBlobPath(id);
        try
        {
            return new FileStream(
                blobPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read | FileShare.Delete,
                bufferSize: 81920,
                useAsync: true);
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
    }

    public static async Task<T?> ReadBlob<T>(Guid id)
    {
        var stream = ReadBlob(id);
        if (stream == null) return default;
        await using var fileStream = stream;
        await using var decompressionStream = new DecompressionStream(fileStream);
        return await MemoryPackSerializer.DeserializeAsync<T>(decompressionStream);
    }

    public static void Delete(Guid id)
    {
        var blobPath = GetBlobPath(id);

        // Delete the file
        if (File.Exists(blobPath))
        {
            File.Delete(blobPath);
        }

        lock (LockObj)
        {
            // Clean up empty directories
            // Structure: CONFIG_PATH/blobs/{firstTwo}/{nextTwo}/{fileName}
            var nextTwoDir = Path.GetDirectoryName(blobPath);
            var firstTwoDir = Path.GetDirectoryName(nextTwoDir);

            TryDeleteEmptyDirectory(nextTwoDir);
            TryDeleteEmptyDirectory(firstTwoDir);
        }
    }

    private static void TryDeleteEmptyDirectory(string? directory)
    {
        if (string.IsNullOrEmpty(directory)) return;
        if (!Directory.Exists(directory)) return;
        if (!IsDirectoryEmpty(directory)) return;
        Directory.Delete(directory, recursive: false);
    }

    private static bool IsDirectoryEmpty(string path)
    {
        return !Directory.EnumerateFileSystemEntries(path).Any();
    }
}