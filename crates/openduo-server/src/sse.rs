use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;

pub fn sse_response<S>(stream: S) -> Sse<impl Stream<Item = Result<Event, Infallible>>>
where
    S: Stream<Item = String> + Send + 'static,
{
    use futures::StreamExt;
    let event_stream = stream.map(|data| Ok::<_, Infallible>(Event::default().data(data)));
    Sse::new(event_stream).keep_alive(KeepAlive::default())
}
