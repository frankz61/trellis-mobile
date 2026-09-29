// Incremental text/event-stream parser. Network chunks split events and even
// multi-byte characters arbitrarily, so callers feed decoded text and read out
// only the events that have been fully terminated by a blank line.
export class SseParser {
  private buffer = '';
  private data: string[] = [];

  push(text: string): string[] {
    this.buffer += text;
    const events: string[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        if (this.data.length) events.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(line[5] === ' ' ? 6 : 5));
      }
      // Comments, event:, id: and retry: are ignored by this client.
    }
    return events;
  }

  // A stream that ends without a trailing blank line still carries its last event.
  flush(): string[] {
    return this.push('\n\n');
  }
}
