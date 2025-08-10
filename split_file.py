# split_glove.py
import os
import argparse

def split_file(input_file_path, lines_per_chunk=100000):
    """
    Splits the large GloVe file into multiple smaller files.
    The default 100,000 lines will split the 400,000-line file into 4 parts.
    """
    print(f"Splitting file {input_file_path} into chunks of {lines_per_chunk} lines...")
    with open(input_file_path, 'r', encoding='utf-8') as f_in:
        count = 0
        file_count = 1
        f_out = None
        for line in f_in:
            if count % lines_per_chunk == 0:
                if f_out:
                    f_out.close()
                output_file_path = f"{os.path.splitext(input_file_path)[0]}_part_{file_count}.txt"
                f_out = open(output_file_path, 'w', encoding='utf-8')
                print(f"Creating {output_file_path}...")
                file_count += 1
            f_out.write(line)
            count += 1
        if f_out:
            f_out.close()
    print("Done.")

def main():
    parser = argparse.ArgumentParser(description="Split a large file into smaller chunks.")
    parser.add_argument("-input", type=str, required=True,
                        help="Path to the large file to split.")
    parser.add_argument("-lines", type=int, default=100000,
                        help="Number of lines per output chunk file.")

    args = parser.parse_args()

    split_file(args.input, args.lines)

if __name__ == "__main__":
    main()