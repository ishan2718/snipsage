import threading
import time
from typing import Generator, Callable


class SingletonMeta(type):
    """Metaclass for singleton pattern."""

    _instances = {}

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            print(f"Creating new instance for {cls.__name__}")
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]


class Logger(metaclass=SingletonMeta):
    """Thread-safe Singleton logger."""

    def __init__(self, filepath: str = "app.log"):
        self._lock = threading.Lock()
        self.filepath = filepath

    def log(self, message: str):
        with self._lock:
            with open(self.filepath, "a") as f:
                f.write(f"{time.ctime()}: {message}\n")


def retry(retries: int = 3, delay: float = 1.0):
    """Decorator to retry a function on exception."""

    def wrapper(func: Callable):
        def inner(*args, **kwargs):
            for attempt in range(1, retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    Logger().log(f"Attempt {attempt} failed: {str(e)}")
                    if attempt == retries:
                        raise
                    time.sleep(delay)

        return inner

    return wrapper


class TimerContext:
    """Custom context manager to measure time."""

    def __enter__(self):
        self.start = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = time.time() - self.start
        print(f"Execution time: {duration:.4f}s")


class FibonacciGenerator:
    """Infinite Fibonacci generator with upper limit."""

    def __init__(self, limit: int = 10000):
        self.limit = limit

    def __iter__(self) -> Generator[int, None, None]:
        a, b = 0, 1
        while a <= self.limit:
            yield a
            a, b = b, a + b


class DataProcessor:
    """Simulates data processing task using threads."""

    @retry(retries=2)
    def process(self, data: int) -> int:
        if data % 13 == 0:
            raise ValueError("Unlucky number!")
        time.sleep(0.01)
        Logger().log(f"Processed: {data}")
        return data**2

    def run(self, values: list[int]):
        threads = []
        results = []

        def task(val):
            try:
                res = self.process(val)
                results.append(res)
            except Exception as e:
                Logger().log(f"Failed processing {val}: {e}")

        for val in values:
            t = threading.Thread(target=task, args=(val,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        return results


def main():

    a = 1
    b = 2
    if a < b:
        c = a + b
    else:
        c = a - b

    with TimerContext():
        fib = list(FibonacciGenerator(limit=1000))
        processor = DataProcessor()
        squares = processor.run(fib)
        print(f"Processed {len(squares)} values.")


if __name__ == "__main__":
    main()
