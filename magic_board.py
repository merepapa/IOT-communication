def ascii_to_char_converter():
    # Take four ASCII values as input from the user
    ascii_values = input("Enter four ASCII values separated by spaces: ").split()
    
    # Check if the user has entered exactly four values
    if len(ascii_values) != 4:
        print("Please enter exactly four ASCII values.")
        return

    # Convert ASCII values to characters and print them
    for index, value in enumerate(ascii_values):
        try:
            ascii_num = int(value)
            char = chr(ascii_num)
            print(f"{value}-{char}")
        except ValueError:
            print(f"{value} is not a valid ASCII number.")

# Run the converter function
if __name__ == "__main__":
    ascii_to_char_converter()